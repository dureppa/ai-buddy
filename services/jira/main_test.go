package main

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

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const testSecret = "jira-test-secret-with-at-least-32-characters"

func token(t *testing.T, user, audience string, expires time.Time) string {
	t.Helper()
	value, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: user, Issuer: "jira", Audience: jwt.ClaimStrings{audience}, ExpiresAt: jwt.NewNumericDate(expires)}).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func call(h http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestAuth(t *testing.T) {
	s := server{secret: []byte(testSecret)}
	for _, value := range []string{"", "bad", token(t, "maria", "other", time.Now().Add(time.Hour)), token(t, "maria", "jira", time.Now().Add(-time.Hour)), token(t, "", "jira", time.Now().Add(time.Hour))} {
		w := call(s.routes(), "GET", "/api/v1/spaces", "", value)
		if w.Code != 401 {
			t.Fatalf("expected 401, got %d", w.Code)
		}
	}
	w := call(s.routes(), "POST", "/api/v1/demo/sessions", `{"profile_id":"maria"}`, "")
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}
func TestInput(t *testing.T) {
	valid := func() issueInput { return issueInput{Title: " Example ", Status: "todo", Priority: "medium"} }
	for _, change := range []func(*issueInput){func(i *issueInput) { i.Title = " " }, func(i *issueInput) { i.Title = strings.Repeat("я", 201) }, func(i *issueInput) { i.Description = strings.Repeat("a", 10001) }, func(i *issueInput) { i.Status = "bad" }, func(i *issueInput) { i.Priority = "urgent" }, func(i *issueInput) { v := "2026-02-30"; i.DueDate = &v }, func(i *issueInput) { v := ""; i.Assignee = &v }} {
		input := valid()
		change(&input)
		if input.valid() {
			t.Fatal("invalid input accepted")
		}
	}
	input := valid()
	if !input.valid() || input.Title != "Example" {
		t.Fatal(input)
	}
	date := "2026-11-20"
	input.DueDate = &date
	if !input.valid() {
		t.Fatal("valid date rejected")
	}
	for _, raw := range []string{`{`, `{"unknown":true}`, `{} {}`, strings.Repeat(" ", 65537) + `{}`} {
		if body(httptest.NewRecorder(), httptest.NewRequest("POST", "/", strings.NewReader(raw)), &issueInput{}) == nil {
			t.Fatal("bad JSON accepted")
		}
	}
}
func database(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("JIRA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set JIRA_TEST_DATABASE_URL for PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("jira_test_%d", time.Now().UnixNano())
	safe := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+safe); err != nil {
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close(); _, _ = admin.Exec(ctx, "DROP SCHEMA "+safe+" CASCADE"); admin.Close() })
	for _, file := range []string{"migrations/001.up.sql", "seeds/demo.sql"} {
		sql, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(sql)); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}
func TestPostgresWorkflow(t *testing.T) {
	pool := database(t)
	s := server{pool, []byte(testSecret), true}
	h := s.routes()
	maria := token(t, "maria", "jira", time.Now().Add(time.Hour))
	sasha := token(t, "sasha", "jira", time.Now().Add(time.Hour))
	check := func(method, path, raw, tok string, status int) *httptest.ResponseRecorder {
		t.Helper()
		w := call(h, method, path, raw, tok)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w
	}
	check("GET", "/health", "", "", 200)
	check("POST", "/api/v1/demo/sessions", `{"profile_id":"maria"}`, "", 200)
	check("POST", "/api/v1/demo/sessions", `{"profile_id":"unknown"}`, "", 400)
	check("POST", "/api/v1/demo/sessions", `{"profile_id":"maria","admin":true}`, "", 400)
	spaces := check("GET", "/api/v1/spaces", "", maria, 200).Body.String()
	if strings.Contains(spaces, "travel") || !strings.Contains(spaces, "help") {
		t.Fatal(spaces)
	}
	boards := check("GET", "/api/v1/spaces/help/boards", "", maria, 200).Body.String()
	if strings.Contains(boards, "planning") {
		t.Fatal(boards)
	}
	check("GET", "/api/v1/spaces/travel/boards", "", maria, 404)
	check("GET", "/api/v1/boards/help-planning", "", maria, 404)
	check("GET", "/api/v1/boards/help-team", "", sasha, 404)
	check("GET", "/api/v1/boards/help-team", "", maria, 200)
	create := `{"title":"Новая задача","description":"Описание","status":"todo","priority":"high","assignee_id":"maria","due_date":"2026-11-20","version":1}`
	check("POST", "/api/v1/boards/help-planning/issues", create, maria, 404)
	check("POST", "/api/v1/boards/help-team/issues", strings.Replace(create, `"maria"`, `"sasha"`, 1), maria, 400)
	check("POST", "/api/v1/boards/help-team/issues", `{}`, maria, 400)
	w := check("POST", "/api/v1/boards/help-team/issues", create, maria, 201)
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/issues/" + created.ID
	check("GET", path, "", sasha, 404)
	check("GET", "/api/v1/issues/not-a-uuid", "", maria, 404)
	check("GET", path, "", maria, 200)
	check("PUT", path, create, sasha, 404)
	changed := strings.Replace(create, `"todo"`, `"done"`, 1)
	check("PUT", path, changed, maria, 200)
	check("PUT", path, create, maria, 409)
	updated := check("GET", path, "", maria, 200).Body.String()
	if !strings.Contains(updated, `"status":"done"`) && !strings.Contains(updated, `"status": "done"`) {
		t.Fatal(updated)
	}
	mine := check("GET", "/api/v1/me/issues", "", maria, 200).Body.String()
	if !strings.Contains(mine, created.ID) || strings.Contains(mine, "travel") {
		t.Fatal(mine)
	}
	// Reapplying seed must preserve edits.
	seed, _ := os.ReadFile("seeds/demo.sql")
	if _, err := pool.Exec(context.Background(), string(seed)); err != nil {
		t.Fatal(err)
	}
	check("GET", path, "", maria, 200)
	// Database constraints reject cross-space board members.
	if _, err := pool.Exec(context.Background(), `INSERT INTO board_members VALUES('help-team','help','sasha')`); err == nil {
		t.Fatal("cross-space membership accepted")
	}
	// Removing membership immediately revokes reads and writes, even with a valid JWT.
	if _, err := pool.Exec(context.Background(), `UPDATE issues SET assignee_id=NULL WHERE board_id='help-team'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `DELETE FROM board_members WHERE board_id='help-team' AND user_id='maria'`); err != nil {
		t.Fatal(err)
	}
	check("GET", path, "", maria, 404)
	check("PUT", path, changed, maria, 404)
	mine = check("GET", "/api/v1/me/issues", "", maria, 200).Body.String()
	if strings.Contains(mine, created.ID) {
		t.Fatal(mine)
	}
}
func TestConcurrentWrites(t *testing.T) {
	pool := database(t)
	h := (&server{pool, []byte(testSecret), true}).routes()
	tok := token(t, "maria", "jira", time.Now().Add(time.Hour))
	raw := `{"title":"Concurrent","description":"","status":"todo","priority":"medium","assignee_id":null,"due_date":null,"version":1}`
	results := make(chan *httptest.ResponseRecorder, 6)
	for range 6 {
		go func() { results <- call(h, "POST", "/api/v1/boards/help-team/issues", raw, tok) }()
	}
	ids := map[string]bool{}
	for range 6 {
		w := <-results
		if w.Code != 201 {
			t.Fatalf("create %d: %s", w.Code, w.Body.String())
		}
		var v map[string]string
		_ = json.Unmarshal(w.Body.Bytes(), &v)
		if ids[v["id"]] {
			t.Fatal("duplicate issue")
		}
		ids[v["id"]] = true
	}
	var id string
	for value := range ids {
		id = value
		break
	}
	for range 2 {
		go func() { results <- call(h, "PUT", "/api/v1/issues/"+id, raw, tok) }()
	}
	counts := map[int]int{}
	for range 2 {
		w := <-results
		counts[w.Code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatal(counts)
	}
}
func TestDatabaseFailure(t *testing.T) {
	pool := database(t)
	pool.Close()
	h := (&server{pool, []byte(testSecret), true}).routes()
	tok := token(t, "maria", "jira", time.Now().Add(time.Hour))
	for _, path := range []string{"/health", "/api/v1/spaces", "/api/v1/spaces/help/boards", "/api/v1/boards/help-team", "/api/v1/me/issues", "/api/v1/issues/test"} {
		w := call(h, "GET", path, "", tok)
		if w.Code != 503 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
	w := call(h, "POST", "/api/v1/demo/sessions", `{"profile_id":"maria"}`, "")
	if w.Code != 503 {
		t.Fatal(w.Code)
	}
}
