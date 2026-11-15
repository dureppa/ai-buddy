package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"regexp"
	"slices"
	"time"

	"github.com/dureppa/ai-buddy/tools/shared"
	"github.com/jackc/pgx/v5/pgxpool"
)

type record struct {
	Team        string            `json:"team"`
	ID          string            `json:"id"`
	Title       string            `json:"title"`
	Status      string            `json:"status"`
	Description string            `json:"description"`
	Fields      map[string]string `json:"fields"`
}

type page struct {
	Name    string   `json:"name"`
	Area    string   `json:"area"`
	Records []record `json:"records"`
}

func routes(db *pgxpool.Pool, name string, demo page, sessions shared.Sessions) http.Handler {
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
	mux.HandleFunc("POST /api/v1/work-tools/"+name+"/demo/sessions", sessions.Login)
	mux.HandleFunc("GET /api/v1/work-tools/"+name, func(w http.ResponseWriter, r *http.Request) {
		product := sessions.Product(r)
		if product == "" {
			shared.Error(w, 401, "unauthenticated")
			return
		}
		if !slices.ContainsFunc(demo.Records, func(item record) bool { return item.Team == product }) {
			shared.Error(w, 404, "not_found")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		rows, err := db.Query(ctx, "SELECT payload FROM records WHERE team=$1 ORDER BY id LIMIT 100", product)
		if err != nil {
			shared.Error(w, 503, "unavailable")
			return
		}
		defer rows.Close()
		result := page{Name: demo.Name, Area: demo.Area, Records: []record{}}
		for rows.Next() {
			var item record
			if err := rows.Scan(&item); err != nil {
				shared.Error(w, 503, "unavailable")
				return
			}
			result.Records = append(result.Records, item)
		}
		if err := rows.Err(); err != nil {
			shared.Error(w, 503, "unavailable")
			return
		}
		shared.Write(w, 200, result)
	})
	return mux
}

func main() {
	name := os.Getenv("WORK_TOOL")
	secret := os.Getenv("SESSION_SECRET")
	delegate := os.Getenv("TOOL_DELEGATION_SECRET")
	if !regexp.MustCompile(`^[a-z][a-z-]{0,30}$`).MatchString(name) || len(secret) < 32 || len(delegate) < 32 || len(os.Getenv("HTTP_ADDR")) == 0 {
		log.Fatal("a valid WORK_TOOL, HTTP_ADDR and two secrets of at least 32 bytes are required")
	}
	raw, err := os.ReadFile("/data/" + name + "/demo.json")
	if err != nil {
		log.Fatal(err)
	}
	var demo page
	if err := json.Unmarshal(raw, &demo); err != nil || demo.Name == "" {
		log.Fatal("invalid tool fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, "")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := db.Ping(ctx); err != nil {
		log.Fatal("could not connect to tool database")
	}
	sessions := shared.Sessions{
		Secret:           []byte(secret),
		DelegationSecret: []byte(delegate),
		Audience:         name,
		Demo:             os.Getenv("DEMO_MODE") == "true",
	}
	server := &http.Server{
		Addr: os.Getenv("HTTP_ADDR"), Handler: routes(db, name, demo, sessions),
		ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second,
	}
	log.Fatal(server.ListenAndServe())
}
