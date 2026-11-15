package portal

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const pageSelect = `SELECT id,product_id,parent_id,kind,title,body,version,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM confluence_pages `

func scanPage(row pgx.Row) (Page, error) {
	var p Page
	err := row.Scan(&p.ID, &p.Product, &p.Parent, &p.Kind, &p.Title, &p.Body, &p.Version, &p.Updated)
	return p, err
}
func (s *Service) Pages(ctx context.Context, subject, query string) ([]Page, error) {
	identity, err := s.Identity(ctx, subject)
	if err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if len([]rune(query)) > 500 {
		return nil, buddy.ErrInvalidInput
	}
	if s.ExternalKnowledge != nil {
		return s.ExternalKnowledge.Pages(ctx, subject, query)
	}
	rows, err := s.knowledgeDB().Query(ctx, pageSelect+`WHERE (product_id IS NULL OR product_id=$1) AND ($2='' OR title ILIKE '%'||$2||'%' OR body ILIKE '%'||$2||'%') ORDER BY CASE kind WHEN 'product' THEN 0 WHEN 'team' THEN 1 WHEN 'role' THEN 2 ELSE 3 END,title LIMIT 100`, identity.Product, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Page{}
	for rows.Next() {
		p, err := scanPage(rows)
		if err != nil {
			return nil, err
		}
		p.Body = ""
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *Service) Page(ctx context.Context, subject, id string) (Page, error) {
	identity, err := s.Identity(ctx, subject)
	if err != nil {
		return Page{}, err
	}
	if s.ExternalKnowledge != nil {
		return s.ExternalKnowledge.Page(ctx, subject, id)
	}
	p, err := scanPage(s.knowledgeDB().QueryRow(ctx, pageSelect+`WHERE id=$1 AND (product_id IS NULL OR product_id=$2)`, id, identity.Product))
	if errors.Is(err, pgx.ErrNoRows) {
		return Page{}, buddy.ErrNotFound
	}
	return p, err
}
func (s *Service) Search(ctx context.Context, subject, query string, limit int) (map[string]any, error) {
	identity, err := s.Identity(ctx, subject)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(query) == "" || len([]rune(query)) > 500 || limit < 1 || limit > 5 {
		return nil, buddy.ErrInvalidInput
	}
	query = buddy.KnowledgeSearchQuery(query)
	terms := strings.Join(strings.Fields(query), " OR ")
	corpus := `SELECT 'confluence:'||id AS id,title,left(body,1200) AS excerpt,body AS search_text,version,$4||'?page='||id AS url FROM confluence_pages WHERE product_id IS NULL OR product_id=$1`
	articles := `SELECT id,title,left(content,1200) AS excerpt,content AS search_text,1 AS version,url FROM knowledge_articles`
	if s.ExternalKnowledge != nil {
		pages, err := s.ExternalKnowledge.Search(ctx, subject, query, limit)
		if err != nil {
			return nil, err
		}
		docs := make([]any, 0, limit)
		for _, p := range pages {
			excerpt := []rune(p.Body)
			docs = append(docs, map[string]any{
				"source":  s.Source("confluence:"+p.ID, p.Title, s.KnowledgeURL+"?page="+url.QueryEscape(p.ID), p.Version),
				"excerpt": string(excerpt[:min(1200, len(excerpt))]),
			})
		}
		if len(docs) < limit {
			extra, err := s.searchCorpus(ctx, s.DB, articles+" WHERE $1::text IS NOT NULL AND $4::text IS NOT NULL", identity.Product, terms, limit-len(docs), s.KnowledgeURL)
			if err != nil {
				return nil, err
			}
			docs = append(docs, extra["documents"].([]any)...)
		}
		return map[string]any{"documents": docs}, nil
	}
	if s.KnowledgeDB == nil {
		return s.searchCorpus(ctx, s.DB, corpus+" UNION ALL "+articles, identity.Product, terms, limit, s.KnowledgeURL)
	}
	result, err := s.searchCorpus(ctx, s.KnowledgeDB, corpus, identity.Product, terms, limit, s.KnowledgeURL)
	if err != nil {
		return nil, err
	}
	docs := result["documents"].([]any)
	if len(docs) < limit {
		extra, err := s.searchCorpus(ctx, s.DB, articles+" WHERE $1::text IS NOT NULL AND $4::text IS NOT NULL", identity.Product, terms, limit-len(docs), s.KnowledgeURL)
		if err != nil {
			return nil, err
		}
		result["documents"] = append(docs, extra["documents"].([]any)...)
	}
	return result, nil
}

func (s *Service) searchCorpus(ctx context.Context, db *pgxpool.Pool, corpus, team, terms string, limit int, origin string) (map[string]any, error) {
	rows, err := db.Query(ctx, "WITH corpus AS ("+corpus+`) SELECT id,title,excerpt,version,url FROM corpus WHERE to_tsvector('russian',title||' '||search_text) @@ websearch_to_tsquery('russian',$2) ORDER BY ts_rank(to_tsvector('russian',title||' '||search_text),websearch_to_tsquery('russian',$2)) DESC,id LIMIT $3`, team, terms, limit, origin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	docs := []any{}
	for rows.Next() {
		var id, title, excerpt, link string
		var version int
		if err := rows.Scan(&id, &title, &excerpt, &version, &link); err != nil {
			return nil, err
		}
		docs = append(docs, map[string]any{"source": s.Source(id, title, link, version), "excerpt": excerpt})
	}
	return map[string]any{"documents": docs}, rows.Err()
}
func (s *Service) Tool(ctx context.Context, subject, tool string, args map[string]any, operation string) (map[string]any, error) {
	switch tool {
	case "get_access_catalog":
		if len(args) != 0 {
			return nil, buddy.ErrInvalidInput
		}
		data, err := s.GetCatalog(ctx, subject)
		if err != nil {
			return nil, err
		}
		data["references"] = []any{s.Source("access-catalog", "Каталог доступов", s.AccessURL, 1)}
		return data, nil
	case "submit_access_request":
		raw, err := marshalArguments(args)
		if err != nil {
			return nil, err
		}
		var in Input
		if err := strictInput(raw, &in); err != nil {
			return nil, buddy.ErrInvalidInput
		}
		r, err := s.Submit(ctx, subject, in, operation, "agent")
		if err != nil {
			return nil, err
		}
		return map[string]any{"request": summary(r), "references": []any{s.Source("access:"+r.ID, r.Number, s.AccessURL+"?request="+url.QueryEscape(r.ID), 1)}}, nil
	case "get_access_requests":
		if len(args) != 0 {
			return nil, buddy.ErrInvalidInput
		}
		records, err := s.List(ctx, subject)
		if err != nil {
			return nil, err
		}
		items := []any{}
		for _, r := range records {
			if len(items) == 20 {
				break
			}
			items = append(items, summary(r))
		}
		return map[string]any{"requests": items, "references": []any{s.Source("access-requests:"+subject, "Мои заявки", s.AccessURL+"?tab=requests", 1)}}, nil
	case "get_knowledge_page":
		id, ok := args["page_id"].(string)
		if !ok || len(args) != 1 {
			return nil, buddy.ErrInvalidInput
		}
		p, err := s.Page(ctx, subject, strings.TrimPrefix(id, "confluence:"))
		if err != nil {
			return nil, err
		}
		return map[string]any{"page": p, "references": []any{s.Source("confluence:"+p.ID, p.Title, s.KnowledgeURL+"?page="+url.QueryEscape(p.ID), p.Version)}}, nil
	default:
		return nil, buddy.ErrNotFound
	}
}
func summary(r Request) map[string]any {
	return map[string]any{"id": r.ID, "number": r.Number, "status": r.Status, "system": r.Input.System, "resource_key": r.Input.Key, "permission": r.Input.Permission, "duration_days": r.Input.Days}
}
