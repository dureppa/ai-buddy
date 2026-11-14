package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type server struct {
	db     *pgxpool.Pool
	secret []byte
	demo   bool
}
type issueInput struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Status      string  `json:"status"`
	Priority    string  `json:"priority"`
	Assignee    *string `json:"assignee_id"`
	DueDate     *string `json:"due_date"`
	Version     int     `json:"version"`
}

func main() {
	secret := os.Getenv("JIRA_SESSION_SECRET")
	if len(secret) < 32 {
		slog.Error("JIRA_SESSION_SECRET must contain at least 32 characters")
		os.Exit(1)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		slog.Error("database config", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	s := server{pool, []byte(secret), os.Getenv("DEMO_MODE") == "true"}
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8189"
	}
	srv := http.Server{Addr: addr, Handler: s.routes(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	slog.Info("Jira API", "addr", addr)
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("server", "error", err)
		os.Exit(1)
	}
}
func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.db.Ping(ctx); err != nil {
			fail(w, 503, "unavailable")
			return
		}
		respond(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/v1/demo/sessions", s.login)
	mux.HandleFunc("GET /api/v1/spaces", s.auth(s.spaces))
	mux.HandleFunc("GET /api/v1/spaces/{space}/boards", s.auth(s.boards))
	mux.HandleFunc("GET /api/v1/boards/{board}", s.auth(s.board))
	mux.HandleFunc("GET /api/v1/me/issues", s.auth(s.mine))
	mux.HandleFunc("GET /api/v1/issues/{issue}", s.auth(s.issue))
	mux.HandleFunc("POST /api/v1/boards/{board}/issues", s.auth(s.create))
	mux.HandleFunc("PUT /api/v1/issues/{issue}", s.auth(s.update))
	return mux
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]string{"code": code})
}
func body(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 65536)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return errors.New("extra JSON")
	}
	return nil
}
func (s *server) auth(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			fail(w, 401, "unauthenticated")
			return
		}
		claims := &jwt.RegisteredClaims{}
		token, err := jwt.ParseWithClaims(strings.TrimPrefix(header, "Bearer "), claims, func(*jwt.Token) (any, error) { return s.secret, nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired(), jwt.WithAudience("jira"), jwt.WithIssuer("jira"))
		if err != nil || !token.Valid || claims.Subject == "" {
			fail(w, 401, "unauthenticated")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		next(w, r.WithContext(ctx), claims.Subject)
	}
}
func (s *server) login(w http.ResponseWriter, r *http.Request) {
	if !s.demo {
		fail(w, 404, "not_found")
		return
	}
	var in struct {
		Profile string `json:"profile_id"`
	}
	if body(w, r, &in) != nil {
		fail(w, 400, "invalid_input")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var name string
	err := s.db.QueryRow(ctx, "SELECT name FROM users WHERE id=$1", in.Profile).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 400, "invalid_profile")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	now := time.Now()
	claims := jwt.RegisteredClaims{Subject: in.Profile, Issuer: "jira", Audience: jwt.ClaimStrings{"jira"}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(8 * time.Hour))}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]string{"access_token": token, "profile_id": in.Profile, "name": name})
}
func (s *server) list(w http.ResponseWriter, r *http.Request, query string, args ...any) {
	var data json.RawMessage
	err := s.db.QueryRow(r.Context(), "SELECT coalesce(json_agg(q),'[]'::json) FROM ("+query+") q", args...).Scan(&data)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	respond(w, 200, data)
}
func (s *server) spaces(w http.ResponseWriter, r *http.Request, user string) {
	s.list(w, r, `SELECT s.id,s.name,s.description FROM spaces s JOIN space_members m ON m.space_id=s.id WHERE m.user_id=$1 ORDER BY s.name`, user)
}
func (s *server) boards(w http.ResponseWriter, r *http.Request, user string) {
	var exists bool
	err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM space_members WHERE space_id=$1 AND user_id=$2)`, r.PathValue("space"), user).Scan(&exists)
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if !exists {
		fail(w, 404, "not_found")
		return
	}
	s.list(w, r, `SELECT b.id,b.space_id,b.name,b.key FROM boards b JOIN board_members m ON m.board_id=b.id WHERE b.space_id=$1 AND m.user_id=$2 ORDER BY b.name`, r.PathValue("space"), user)
}

const visibleBoard = `SELECT 1 FROM board_members m JOIN space_members sm ON sm.space_id=m.space_id AND sm.user_id=m.user_id WHERE m.board_id=b.id AND m.user_id=$1`
const issueFields = `i.id, i.board_id,b.space_id,b.key||'-'||i.number AS key,i.title,i.description,i.status,i.priority,i.assignee_id,i.reporter_id,to_char(i.due_date,'YYYY-MM-DD') AS due_date,i.version,i.created_at,i.updated_at`

func (s *server) board(w http.ResponseWriter, r *http.Request, user string) {
	var data json.RawMessage
	err := s.db.QueryRow(r.Context(), `SELECT json_build_object('id',b.id,'name',b.name,'key',b.key,'space_id',b.space_id,
 'members',(SELECT coalesce(json_agg(json_build_object('id',u.id,'name',u.name) ORDER BY u.name),'[]') FROM users u JOIN board_members m ON m.user_id=u.id WHERE m.board_id=b.id),
 'issues',(SELECT coalesce(json_agg(q ORDER BY q.created_at DESC),'[]') FROM (SELECT `+issueFields+` FROM issues i WHERE i.board_id=b.id) q))
 FROM boards b WHERE b.id=$2 AND EXISTS (`+visibleBoard+`)`, user, r.PathValue("board")).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	respond(w, 200, data)
}
func (s *server) mine(w http.ResponseWriter, r *http.Request, user string) {
	s.list(w, r, `SELECT `+issueFields+` FROM issues i JOIN boards b ON b.id=i.board_id WHERE i.assignee_id=$1 AND EXISTS (`+visibleBoard+`) ORDER BY i.updated_at DESC`, user)
}
func (s *server) issue(w http.ResponseWriter, r *http.Request, user string) {
	var data json.RawMessage
	err := s.db.QueryRow(r.Context(), `SELECT row_to_json(q) FROM (SELECT `+issueFields+` FROM issues i JOIN boards b ON b.id=i.board_id WHERE i.id::text=$2 AND EXISTS (`+visibleBoard+`)) q`, user, r.PathValue("issue")).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	respond(w, 200, data)
}
func (in *issueInput) valid() bool {
	in.Title = strings.TrimSpace(in.Title)
	if strings.ContainsRune(in.Title, 0) || strings.ContainsRune(in.Description, 0) {
		return false
	}
	if utf8.RuneCountInString(in.Title) < 1 || utf8.RuneCountInString(in.Title) > 200 || utf8.RuneCountInString(in.Description) > 10000 {
		return false
	}
	if in.Status != "todo" && in.Status != "in_progress" && in.Status != "review" && in.Status != "done" {
		return false
	}
	if in.Priority != "low" && in.Priority != "medium" && in.Priority != "high" {
		return false
	}
	if in.DueDate != nil {
		if _, err := time.Parse("2006-01-02", *in.DueDate); err != nil {
			return false
		}
	}
	return in.Assignee == nil || *in.Assignee != ""
}
func (s *server) create(w http.ResponseWriter, r *http.Request, user string) {
	s.save(w, r, user, false)
}
func (s *server) update(w http.ResponseWriter, r *http.Request, user string) {
	s.save(w, r, user, true)
}
func (s *server) save(w http.ResponseWriter, r *http.Request, user string, update bool) {
	var in issueInput
	if body(w, r, &in) != nil || !in.valid() || (update && in.Version < 1) {
		fail(w, 400, "invalid_input")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var boardID string
	if update {
		err = tx.QueryRow(r.Context(), `SELECT b.id FROM boards b JOIN issues i ON i.board_id=b.id WHERE i.id::text=$2 AND EXISTS (`+visibleBoard+`) FOR UPDATE OF b`, user, r.PathValue("issue")).Scan(&boardID)
	} else {
		err = tx.QueryRow(r.Context(), `SELECT b.id FROM boards b WHERE b.id=$2 AND EXISTS (`+visibleBoard+`) FOR UPDATE OF b`, user, r.PathValue("board")).Scan(&boardID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	var id string
	if update {
		err = tx.QueryRow(r.Context(), `UPDATE issues SET title=$1,description=$2,status=$3,priority=$4,assignee_id=$5,due_date=$6,version=version+1,updated_at=now() WHERE id::text=$7 AND version=$8 RETURNING id::text`, in.Title, in.Description, in.Status, in.Priority, in.Assignee, in.DueDate, r.PathValue("issue"), in.Version).Scan(&id)
	} else {
		var number int
		err = tx.QueryRow(r.Context(), `UPDATE boards SET next_number=next_number+1 WHERE id=$1 RETURNING next_number-1`, boardID).Scan(&number)
		if err == nil {
			err = tx.QueryRow(r.Context(), `INSERT INTO issues(board_id,number,title,description,status,priority,assignee_id,due_date,reporter_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text`, boardID, number, in.Title, in.Description, in.Status, in.Priority, in.Assignee, in.DueDate, user).Scan(&id)
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 409, "version_conflict")
		return
	}
	var pe *pgconn.PgError
	if errors.As(err, &pe) && (pe.Code == "23503" || pe.Code == "23514") {
		fail(w, 400, "invalid_input")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		fail(w, 503, "unavailable")
		return
	}
	respond(w, map[bool]int{true: 200, false: 201}[update], map[string]string{"id": id})
}
