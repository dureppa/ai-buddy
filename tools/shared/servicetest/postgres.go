// Package servicetest provides an isolated schema for service integration tests.
package servicetest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Postgres(t *testing.T, statements ...string) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	name := fmt.Sprintf("service_check_%d", time.Now().UnixNano())
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+identifier+" CASCADE"); err != nil {
			t.Errorf("drop test schema: %v", err)
		}
	})
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	for _, sql := range statements {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func Check(t *testing.T, handler http.Handler, request *http.Request, status int, contains string) {
	t.Helper()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != status || !strings.Contains(response.Body.String(), contains) {
		t.Fatalf("%s %s: got %d %s, want status %d and body containing %q",
			request.Method, request.URL.Path, response.Code, response.Body.String(), status, contains)
	}
}

func Login(t *testing.T, handler http.Handler, path, profile string) string {
	t.Helper()
	payload := fmt.Sprintf(`{"profile_id":%q}`, profile)
	request := httptest.NewRequest("POST", path, strings.NewReader(payload))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var session struct {
		Token string `json:"access_token"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &session); err != nil || response.Code != 200 || session.Token == "" {
		t.Fatalf("login %s: %d %s", profile, response.Code, response.Body.String())
	}
	return session.Token
}

func Authorized(method, path, token, body string) *http.Request {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	return request
}
