package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/dureppa/ai-buddy/tools/shared"
	"github.com/dureppa/ai-buddy/web/backend/accessapi"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	addr := os.Getenv("HTTP_ADDR")
	secret := os.Getenv("SESSION_SECRET")
	delegation := os.Getenv("ACCESS_DELEGATION_SECRET")
	if addr == "" || len(secret) < 32 || len(delegation) < 32 || secret == delegation {
		log.Fatal("HTTP_ADDR and two distinct secrets of at least 32 bytes are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, "")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	sessions := shared.Sessions{
		Secret: []byte(secret), DelegationSecret: []byte(delegation),
		Audience: "access", Demo: os.Getenv("DEMO_MODE") == "true",
	}
	handler, err := routes(ctx, db, sessions)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	log.Fatal(server.ListenAndServe())
}

func routes(ctx context.Context, db *pgxpool.Pool, sessions shared.Sessions) (http.Handler, error) {
	mux := http.NewServeMux()
	if err := accessapi.Register(ctx, db, mux, sessions.Subject); err != nil {
		return nil, err
	}
	mux.HandleFunc("POST /api/v1/demo/sessions", sessions.Login)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			shared.Error(w, 503, "unavailable")
			return
		}
		shared.Write(w, 200, map[string]string{"status": "ok"})
	})
	return mux, nil
}
