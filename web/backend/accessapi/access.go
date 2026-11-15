// Package accessapi exposes the access portal's HTTP API to its standalone executable.
package accessapi

import (
	"context"
	"net/http"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/dureppa/ai-buddy/web/backend/internal/portal"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Register(ctx context.Context, db *pgxpool.Pool, mux *http.ServeMux, session func(*http.Request) (string, bool)) error {
	service := portal.New(db)
	if err := service.EnsureAccessSeed(ctx); err != nil {
		return err
	}
	service.RegisterAccess(mux, func(r *http.Request) (string, error) {
		subject, _ := session(r)
		if subject == "" {
			return "", buddy.ErrUnauthenticated
		}
		return subject, nil
	}, func(r *http.Request) bool {
		_, delegated := session(r)
		return delegated
	})
	return nil
}
