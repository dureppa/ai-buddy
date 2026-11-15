package portal

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/golang-jwt/jwt/v5"
)

func TestKnowledgeClientDelegatesProfileAndReturnsNotFound(t *testing.T) {
	secret := "testing-confluence-delegation-secret"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := &jwt.RegisteredClaims{}
		token, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) { return []byte(secret), nil },
			jwt.WithAudience("confluence"), jwt.WithExpirationRequired(), jwt.WithValidMethods([]string{"HS256"}))
		if err != nil || !token.Valid || claims.Subject != "olga" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/api/v1/confluence/pages/team-delivery" {
			fmt.Fprint(w, `{"id":"team-delivery","title":"Доставка","version":2}`)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client, err := NewKnowledgeClient(server.URL, secret)
	if err != nil {
		t.Fatal(err)
	}
	got, err := client.Page(context.Background(), "olga", "team-delivery")
	if err != nil || got.Version != 2 {
		t.Fatalf("page = %+v, err = %v", got, err)
	}
	if _, err := client.Page(context.Background(), "olga", "private"); !errors.Is(err, buddy.ErrNotFound) {
		t.Fatalf("error = %v", err)
	}
}
