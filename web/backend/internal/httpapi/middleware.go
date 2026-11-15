package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

type profileCtxKey struct{}

func profileFrom(ctx context.Context) (buddy.Profile, bool) {
	p, ok := ctx.Value(profileCtxKey{}).(buddy.Profile)
	return p, ok
}

func (a *API) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const prefix = "Bearer "
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, prefix) {
			writeError(w, buddy.ErrUnauthenticated)
			return
		}
		p, err := a.sessions.Authenticate(r.Context(), strings.TrimPrefix(header, prefix))
		if err != nil {
			writeError(w, err)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), profileCtxKey{}, p)))
	}
}
