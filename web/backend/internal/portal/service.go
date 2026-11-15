// Package portal owns persistent access requests and the scoped Confluence corpus.
package portal

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed catalog.json
var catalogJSON []byte

//go:embed pages.json
var pagesJSON []byte

type Field struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Placeholder string   `json:"placeholder,omitempty"`
	Options     []string `json:"options,omitempty"`
}
type Resource struct {
	Key    string            `json:"resource_key"`
	Fields map[string]string `json:"fields"`
}
type Template struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Icon        string     `json:"icon"`
	Color       string     `json:"color"`
	Roles       []string   `json:"roles"`
	System      string     `json:"system"`
	KeyHint     string     `json:"keyHint"`
	Levels      []string   `json:"levels"`
	Fields      []Field    `json:"fields"`
	Owner       string     `json:"owner"`
	Resources   []Resource `json:"resources"`
}
type Catalog struct {
	Version   int        `json:"version"`
	Templates []Template `json:"templates"`
}
type Identity struct {
	ID        string `json:"profile_id"`
	Product   string `json:"product_id"`
	Role      string `json:"job_role"`
	Name      string `json:"name"`
	Team      string `json:"team_name"`
	CanReview bool   `json:"can_review"`
}
type Input struct {
	TemplateID    string            `json:"template_id"`
	Version       int               `json:"catalog_version"`
	System        string            `json:"system"`
	Key           string            `json:"resource_key"`
	Justification string            `json:"justification"`
	Permission    string            `json:"permission"`
	Days          int               `json:"duration_days"`
	Fields        map[string]string `json:"fields"`
}
type Request struct {
	ID         string  `json:"id"`
	Number     string  `json:"number"`
	Profile    string  `json:"profile_id"`
	Product    string  `json:"product_id"`
	Input      Input   `json:"input"`
	Status     string  `json:"status"`
	Created    string  `json:"created_at"`
	DecisionBy *string `json:"decision_by"`
	Note       string  `json:"decision_note"`
	Decided    *string `json:"decided_at"`
	Origin     string  `json:"origin"`
}
type Page struct {
	ID      string  `json:"id"`
	Product *string `json:"product_id"`
	Parent  *string `json:"parent_id"`
	Kind    string  `json:"kind"`
	Title   string  `json:"title"`
	Body    string  `json:"body"`
	Version int     `json:"version"`
	Updated string  `json:"updated_at"`
}
type Service struct {
	ExternalAccess    *AccessClient
	ExternalKnowledge *KnowledgeClient
	KnowledgeDB       *pgxpool.Pool
	DB                *pgxpool.Pool
	Catalog           Catalog
	AccessURL         string
	KnowledgeURL      string
}

var ErrConflict = errors.New("request changed")

func New(db *pgxpool.Pool) *Service {
	s := &Service{DB: db, AccessURL: "http://localhost:5190/", KnowledgeURL: "http://localhost:5191/"}
	if err := json.Unmarshal(catalogJSON, &s.Catalog); err != nil {
		panic(err)
	}
	return s
}
func (s *Service) Identity(ctx context.Context, id string) (Identity, error) {
	var out Identity
	err := s.DB.QueryRow(ctx, `SELECT p.id,p.team_id,coalesce(p.job_role,''),p.display_name,t.name FROM profiles p JOIN teams t ON t.id=p.team_id WHERE p.id=$1 AND p.job_role IS NOT NULL`, id).Scan(&out.ID, &out.Product, &out.Role, &out.Name, &out.Team)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, buddy.ErrForbidden
	}
	return out, err
}
func (s *Service) Validate(in *Input, identity Identity) error {
	in.System = strings.TrimSpace(in.System)
	in.Key = strings.TrimSpace(in.Key)
	in.Justification = strings.TrimSpace(in.Justification)
	if identity.Role == "staff" {
		return buddy.ErrForbidden
	}
	if in.Version != s.Catalog.Version || in.Days < 1 || in.Days > 90 || utf8.RuneCountInString(in.Justification) < 10 || utf8.RuneCountInString(in.Justification) > 2000 || len(in.Key) > 160 || strings.ContainsRune(in.Justification, 0) {
		return buddy.ErrInvalidInput
	}
	var template *Template
	for i := range s.Catalog.Templates {
		if s.Catalog.Templates[i].ID == in.TemplateID {
			template = &s.Catalog.Templates[i]
			break
		}
	}
	if template == nil || in.System != template.System || !slices.Contains(template.Levels, in.Permission) {
		return buddy.ErrInvalidInput
	}
	if len(template.Roles) > 0 && !slices.Contains(template.Roles, identity.Role) {
		return buddy.ErrForbidden
	}
	if len(in.Fields) != len(template.Fields) {
		return buddy.ErrInvalidInput
	}
	for _, field := range template.Fields {
		value := strings.TrimSpace(in.Fields[field.Key])
		if value == "" || utf8.RuneCountInString(value) > 500 || strings.ContainsRune(value, 0) || (len(field.Options) > 0 && !slices.Contains(field.Options, value)) {
			return buddy.ErrInvalidInput
		}
		if strings.HasSuffix(field.Key, "_url") {
			u, err := url.Parse(value)
			if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
				return buddy.ErrInvalidInput
			}
		}
		in.Fields[field.Key] = value
	}
	return nil
}
func (s *Service) GetCatalog(ctx context.Context, subject string) (map[string]any, error) {
	if s.ExternalAccess != nil {
		return s.ExternalAccess.Catalog(ctx, subject)
	}
	identity, err := s.Identity(ctx, subject)
	if err != nil {
		return nil, err
	}
	out := []Template{}
	for _, t := range s.Catalog.Templates {
		if identity.Role != "staff" && len(t.Roles) > 0 && !slices.Contains(t.Roles, identity.Role) {
			continue
		}
		t.Resources = []Resource{}
		rows, err := s.DB.Query(ctx, `SELECT resource_key,fields FROM portal_resources WHERE product_id=$1 AND template_id=$2 ORDER BY resource_key`, identity.Product, t.ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var r Resource
			if err := rows.Scan(&r.Key, &r.Fields); err != nil {
				rows.Close()
				return nil, err
			}
			t.Resources = append(t.Resources, r)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return map[string]any{"version": s.Catalog.Version, "templates": out, "context": identity}, nil
}

const requestSelect = `SELECT id::text,'ДОС-'||lpad(number::text,6,'0'),profile_id,product_id,input,status,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),decision_by,decision_note,to_char(decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),origin FROM portal_access_requests `

func scanRequest(row pgx.Row) (Request, error) {
	var r Request
	err := row.Scan(&r.ID, &r.Number, &r.Profile, &r.Product, &r.Input, &r.Status, &r.Created, &r.DecisionBy, &r.Note, &r.Decided, &r.Origin)
	return r, err
}
func (s *Service) Submit(ctx context.Context, subject string, input Input, key, origin string) (Request, error) {
	if s.ExternalAccess != nil {
		return s.ExternalAccess.Submit(ctx, subject, input, key, origin)
	}
	identity, err := s.Identity(ctx, subject)
	if err != nil {
		return Request{}, err
	}
	if err = s.Validate(&input, identity); err != nil {
		return Request{}, err
	}
	if key == "" || len(key) > 128 || (origin != "portal" && origin != "agent") {
		return Request{}, buddy.ErrInvalidInput
	}
	var defaults map[string]string
	err = s.DB.QueryRow(ctx, `SELECT fields FROM portal_resources WHERE product_id=$1 AND template_id=$2 AND resource_key=$3`, identity.Product, input.TemplateID, input.Key).Scan(&defaults)
	if errors.Is(err, pgx.ErrNoRows) {
		return Request{}, buddy.ErrForbidden
	}
	if err != nil {
		return Request{}, err
	}
	// Resource-bound fields cannot be used to switch to another team's namespace or repository.
	for field, value := range defaults {
		if input.Fields[field] != value {
			return Request{}, buddy.ErrForbidden
		}
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return Request{}, err
	}
	fields, _ := json.Marshal(input.Fields)
	hash := sha256.Sum256(fields)
	scope := hex.EncodeToString(hash[:])
	var id string
	err = s.DB.QueryRow(ctx, `INSERT INTO portal_access_requests(profile_id,product_id,template_id,resource_key,permission,scope_key,input,operation_key,origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id::text`, subject, identity.Product, input.TemplateID, input.Key, input.Permission, scope, raw, key, origin).Scan(&id)
	if err == nil {
		return scanRequest(s.DB.QueryRow(ctx, requestSelect+`WHERE id::text=$1`, id))
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Request{}, err
	}
	r, err := scanRequest(s.DB.QueryRow(ctx, requestSelect+`WHERE profile_id=$1 AND (operation_key=$2 OR (template_id=$3 AND resource_key=$4 AND permission=$5 AND scope_key=$6 AND status IN ('submitted','approved'))) ORDER BY (operation_key=$2) DESC LIMIT 1`, subject, key, input.TemplateID, input.Key, input.Permission, scope))
	if err != nil {
		return Request{}, err
	}
	var operation string
	err = s.DB.QueryRow(ctx, `SELECT operation_key FROM portal_access_requests WHERE id::text=$1`, r.ID).Scan(&operation)
	if err != nil {
		return Request{}, err
	}
	existing, _ := json.Marshal(r.Input)
	if operation == key && string(existing) != string(raw) {
		return Request{}, ErrConflict
	}
	return r, nil
}
func (s *Service) List(ctx context.Context, subject string) ([]Request, error) {
	if s.ExternalAccess != nil {
		return s.ExternalAccess.List(ctx, subject)
	}
	if _, err := s.Identity(ctx, subject); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(ctx, requestSelect+`WHERE profile_id=$1 ORDER BY created_at DESC LIMIT 100`, subject)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Request{}
	for rows.Next() {
		r, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Service) Decide(ctx context.Context, subject, id, action, note string) (Request, error) {
	if s.ExternalAccess != nil {
		return s.ExternalAccess.Decide(ctx, subject, id, action, note)
	}
	if _, err := s.Identity(ctx, subject); err != nil {
		return Request{}, err
	}
	note = strings.TrimSpace(note)
	if action != "cancelled" || utf8.RuneCountInString(note) > 2000 {
		return Request{}, buddy.ErrInvalidInput
	}
	var owned bool
	err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM portal_access_requests WHERE id::text=$1 AND profile_id=$2)`, id, subject).Scan(&owned)
	if err != nil {
		return Request{}, err
	}
	if !owned {
		return Request{}, buddy.ErrNotFound
	}
	tag, err := s.DB.Exec(ctx, `UPDATE portal_access_requests r SET status='cancelled',decision_by=$1,decision_note=$2,decided_at=now() WHERE r.id::text=$3 AND r.profile_id=$1 AND r.status='submitted' AND EXISTS(SELECT 1 FROM profiles p WHERE p.id=r.profile_id AND p.team_id=r.product_id)`, subject, note, id)
	if err != nil {
		return Request{}, err
	}
	if tag.RowsAffected() != 1 {
		return Request{}, ErrConflict
	}
	return scanRequest(s.DB.QueryRow(ctx, requestSelect+`WHERE id::text=$1`, id))
}
func (s *Service) EnsureSeed(ctx context.Context) error {
	return s.ensureSeed(ctx, true)
}

func (s *Service) EnsureAccessSeed(ctx context.Context) error {
	return s.ensureSeed(ctx, false)
}

func (s *Service) ensureSeed(ctx context.Context, includeKnowledge bool) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if s.ExternalAccess == nil {
		for _, product := range []string{"delivery", "travel", "autoteca", "help"} {
			for _, t := range s.Catalog.Templates {
				key := product + "-" + t.ID
				fields := map[string]string{}
				switch t.ID {
				case "dwh":
					key = product + ".orders_mart"
				case "repository":
					key = product + "/service-api"
					fields["repository_url"] = "https://git.example/" + key
				case "environments":
					key = product + "-sandbox"
					fields["namespace"] = product + "-team"
				case "jira":
					key = product + "-team"
					fields["space"] = product
				case "figma":
					fields["project_url"] = "https://figma.example/" + key
				}
				raw, _ := json.Marshal(fields)
				if _, err := tx.Exec(ctx, `INSERT INTO portal_resources(product_id,template_id,resource_key,fields) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, product, t.ID, key, raw); err != nil {
					return err
				}
			}
		}
	}
	if !includeKnowledge {
		return tx.Commit(ctx)
	}
	var pages []Page
	if err := json.Unmarshal(pagesJSON, &pages); err != nil {
		return err
	}
	for _, page := range pages {
		if _, err := tx.Exec(ctx, `INSERT INTO confluence_pages(id,product_id,parent_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, page.ID, page.Product, page.Parent, page.Kind, page.Title, page.Body); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (s *Service) Source(id, title, url string, version int) map[string]any {
	return map[string]any{"id": id, "title": title, "url": url, "version": fmt.Sprintf("v%d", version), "is_demo": true}
}
