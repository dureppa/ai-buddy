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
		req := httptest.NewRequest("GET", "/api/v1/me/documents", nil)
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

func TestPersistentMarksAndIdempotency(t *testing.T) {
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
	profile := "integration-documents-user"
	defer func() { _, _ = pool.Exec(ctx, `DELETE FROM document_marks WHERE profile_id=$1`, profile) }()
	set := func(id, body string) int {
		r := httptest.NewRequest("PUT", "/", strings.NewReader(body))
		r.SetPathValue("id", id)
		w := httptest.NewRecorder()
		handleSet(pool)(w, r, profile)
		return w.Code
	}
	if set("papers", `{}`) != 400 || set("missing", `{"done":true}`) != 400 || set("papers", `{"done":true}`) != 200 {
		t.Fatal("invalid input or write")
	}
	var before, after time.Time
	if err = pool.QueryRow(ctx, `SELECT updated_at FROM document_marks WHERE profile_id=$1 AND item_id='papers'`, profile).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if set("papers", `{"done":true}`) != 200 {
		t.Fatal("repeat failed")
	}
	if err = pool.QueryRow(ctx, `SELECT updated_at FROM document_marks WHERE profile_id=$1 AND item_id='papers'`, profile).Scan(&after); err != nil || !before.Equal(after) {
		t.Fatal("repeat changed evidence version")
	}
	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handleList(pool)(w, r, profile)
	var data []map[string]any
	if json.Unmarshal(w.Body.Bytes(), &data) != nil || len(data) != 3 || data[0]["done"] != true || data[0]["updated_at"] == nil {
		t.Fatal(w.Body.String())
	}
	w = httptest.NewRecorder()
	handleList(pool)(w, r, "other-user")
	if json.Unmarshal(w.Body.Bytes(), &data) != nil || data[0]["done"] != false {
		t.Fatal("profile isolation failed")
	}
	if set("papers", `{"done":false}`) != 200 {
		t.Fatal("clear failed")
	}
}
