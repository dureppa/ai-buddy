package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAuthorization(t *testing.T) {
	secret := "integration-secret"
	valid, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: "olga", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(secret))
	for _, token := range []string{"", "invalid", valid} {
		called := false
		h := requireAuth(secret, func(w http.ResponseWriter, r *http.Request, profile string) {
			called = true
			if profile != "olga" {
				t.Fatal(profile)
			}
			w.WriteHeader(200)
		})
		req := httptest.NewRequest("GET", "/api/v1/me/consents", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		h(rec, req)
		if called != (token == valid) {
			t.Fatal("authorization mismatch")
		}
	}
}
func TestPersistentConsentsAndIdempotency(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, schema); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, seed); err != nil {
		t.Fatal(err)
	}
	profile := "integration-consent-user"
	defer func() { _, _ = pool.Exec(ctx, `DELETE FROM consents WHERE profile_id=$1`, profile) }()
	set := func(body string) int {
		r := httptest.NewRequest("PUT", "/", strings.NewReader(body))
		r.SetPathValue("purpose", "news")
		w := httptest.NewRecorder()
		handleSet(pool)(w, r, profile)
		return w.Code
	}
	if set(`{}`) != 400 || set(`{"granted":true}`) != 200 {
		t.Fatal("invalid input or write")
	}
	var before, after time.Time
	if err = pool.QueryRow(ctx, `SELECT updated_at FROM consents WHERE profile_id=$1 AND purpose='news'`, profile).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if set(`{"granted":true}`) != 200 {
		t.Fatal("repeat failed")
	}
	if err = pool.QueryRow(ctx, `SELECT updated_at FROM consents WHERE profile_id=$1 AND purpose='news'`, profile).Scan(&after); err != nil || !before.Equal(after) {
		t.Fatal("repeat changed evidence version")
	}
	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handleList(pool)(w, r, profile)
	var data []map[string]any
	if json.Unmarshal(w.Body.Bytes(), &data) != nil || len(data) != 2 || data[0]["granted"] != true || data[0]["updated_at"] == nil {
		t.Fatal(w.Body.String())
	}
	w = httptest.NewRecorder()
	handleList(pool)(w, r, "other-user")
	if json.Unmarshal(w.Body.Bytes(), &data) != nil || data[0]["granted"] != false {
		t.Fatal("profile isolation failed")
	}
	if set(`{"granted":false}`) != 200 {
		t.Fatal("revoke failed")
	}
}
