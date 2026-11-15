package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dureppa/ai-buddy/tools/shared"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type page struct {
	ID      string  `json:"id"`
	Product *string `json:"product_id"`
	Parent  *string `json:"parent_id"`
	Kind    string  `json:"kind"`
	Title   string  `json:"title"`
	Body    string  `json:"body"`
	Version int     `json:"version"`
	Updated string  `json:"updated_at"`
}

const columns = `SELECT id, product_id, parent_id, kind, title, body, version,
	to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM confluence_pages`
const scope = `(product_id IS NULL OR product_id=$1)`

func scan(row pgx.Row) (page, error) {
	var p page
	err := row.Scan(&p.ID, &p.Product, &p.Parent, &p.Kind, &p.Title, &p.Body, &p.Version, &p.Updated)
	return p, err
}

func routes(db *pgxpool.Pool, sessions shared.Sessions) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			shared.Error(w, 503, "unavailable")
			return
		}
		shared.Write(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/v1/demo/sessions", sessions.Login)
	authorized := func(handle func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			product := sessions.Product(r)
			if product == "" {
				shared.Error(w, 401, "unauthenticated")
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
			defer cancel()
			handle(w, r.WithContext(ctx), product)
		}
	}
	mux.HandleFunc("GET /api/v1/confluence/pages/{id}", authorized(func(w http.ResponseWriter, r *http.Request, product string) {
		result, err := scan(db.QueryRow(r.Context(), columns+" WHERE "+scope+" AND id=$2", product, r.PathValue("id")))
		if errors.Is(err, pgx.ErrNoRows) {
			shared.Error(w, 404, "not_found")
			return
		}
		if err != nil {
			shared.Error(w, 503, "unavailable")
			return
		}
		shared.Write(w, 200, result)
	}))
	mux.HandleFunc("GET /api/v1/confluence/pages", authorized(func(w http.ResponseWriter, r *http.Request, product string) {
		query := strings.TrimSpace(r.URL.Query().Get("query"))
		if len([]rune(query)) > 500 {
			shared.Error(w, 400, "invalid_input")
			return
		}
		records(w, r, db, true, columns+" WHERE "+scope+`
			AND ($2='' OR title ILIKE '%'||$2||'%' OR body ILIKE '%'||$2||'%')
			ORDER BY CASE kind WHEN 'product' THEN 0 WHEN 'team' THEN 1 WHEN 'role' THEN 2 ELSE 3 END,title LIMIT 100`, product, query)
	}))
	mux.HandleFunc("GET /api/v1/confluence/search", authorized(func(w http.ResponseWriter, r *http.Request, product string) {
		query := strings.Fields(r.URL.Query().Get("query"))
		limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
		if len(query) == 0 || len([]rune(strings.Join(query, " "))) > 500 || err != nil || limit < 1 || limit > 5 {
			shared.Error(w, 400, "invalid_input")
			return
		}
		records(w, r, db, false, columns+" WHERE "+scope+`
			AND to_tsvector('russian',title||' '||body) @@ websearch_to_tsquery('russian',$2)
			ORDER BY ts_rank(to_tsvector('russian',title||' '||body),websearch_to_tsquery('russian',$2)) DESC,id LIMIT $3`,
			product, strings.Join(query, " OR "), limit)
	}))
	return mux
}

func records(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, omitBody bool, query string, args ...any) {
	rows, err := db.Query(r.Context(), query, args...)
	if err != nil {
		shared.Error(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	pages := []page{}
	for rows.Next() {
		result, err := scan(rows)
		if err != nil {
			shared.Error(w, 503, "unavailable")
			return
		}
		if omitBody {
			result.Body = ""
		}
		pages = append(pages, result)
	}
	if err := rows.Err(); err != nil {
		shared.Error(w, 503, "unavailable")
		return
	}
	shared.Write(w, 200, pages)
}

func main() {
	addr := os.Getenv("HTTP_ADDR")
	secret := os.Getenv("SESSION_SECRET")
	if addr == "" || len(secret) < 32 {
		log.Fatal("HTTP_ADDR and a SESSION_SECRET of at least 32 bytes are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, "")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := db.Ping(ctx); err != nil {
		log.Fatal("could not connect to the Confluence database")
	}
	sessions := shared.Sessions{
		Secret:           []byte(secret),
		DelegationSecret: []byte(os.Getenv("CONFLUENCE_DELEGATION_SECRET")),
		Audience:         "confluence",
		Demo:             os.Getenv("DEMO_MODE") == "true",
	}
	server := &http.Server{Addr: addr, Handler: routes(db, sessions), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	log.Fatal(server.ListenAndServe())
}
