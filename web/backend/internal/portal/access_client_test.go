package portal

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestAccessClientPreservesOriginAndIdempotency(t *testing.T) {
	const secret = "test-access-delegation-secret-long"
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := &jwt.RegisteredClaims{}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if _, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) { return []byte(secret), nil },
			jwt.WithAudience("access"), jwt.WithExpirationRequired()); err != nil || claims.Subject != "olga" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var input Input
		if json.NewDecoder(r.Body).Decode(&input) != nil || input.Key != "delivery.orders_mart" ||
			r.Header.Get("Idempotency-Key") != "request-key" || r.Header.Get("X-Access-Origin") != "agent" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusConflict)
	}))
	defer source.Close()

	client, err := NewAccessClient(source.URL, secret)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Submit(context.Background(), "olga", Input{Key: "delivery.orders_mart"}, "request-key", "agent")
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("error = %v, want conflict from access service", err)
	}
}
