package portal

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func testService(t *testing.T) *Service {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	schema := fmt.Sprintf("portal_%d", time.Now().UnixNano())
	safe := pgx.Identifier{schema}.Sanitize()
	_, err = admin.Exec(ctx, "CREATE SCHEMA "+safe)
	require.NoError(t, err)
	cfg, err := pgxpool.ParseConfig(dsn)
	require.NoError(t, err)
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.MaxConns = 8
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	t.Cleanup(func() { pool.Close(); _, _ = admin.Exec(ctx, "DROP SCHEMA "+safe+" CASCADE"); admin.Close() })
	files, err := filepath.Glob("../../migrations/*.up.sql")
	require.NoError(t, err)
	files = append(files, "../../seeds/demo.sql")
	for _, name := range files {
		raw, err := os.ReadFile(name)
		require.NoError(t, err)
		_, err = pool.Exec(ctx, string(raw))
		require.NoError(t, err, name)
	}
	service := New(pool)
	require.NoError(t, service.EnsureSeed(ctx))
	return service
}
func validInput() Input {
	return Input{TemplateID: "dwh", Version: 1, System: "DWH", Key: "delivery.orders_mart", Justification: "Изучить воронку оформления заказа", Permission: "read", Days: 30, Fields: map[string]string{"usage": "Исследование"}}
}
func TestValidateConfiguration(t *testing.T) {
	service := New(nil)
	identity := Identity{Role: "analyst"}
	input := validInput()
	require.NoError(t, service.Validate(&input, identity))
	for _, change := range []func(*Input){func(i *Input) { i.Version = 2 }, func(i *Input) { i.Days = 0 }, func(i *Input) { i.Days = 91 }, func(i *Input) { i.Justification = "short" }, func(i *Input) { i.Justification = "bad\x00data long" }, func(i *Input) { i.TemplateID = "unknown" }, func(i *Input) { i.Permission = "admin" }, func(i *Input) { i.System = "wrong" }, func(i *Input) { i.Fields = map[string]string{} }, func(i *Input) { i.Fields["usage"] = "unknown" }} {
		bad := validInput()
		change(&bad)
		require.Error(t, service.Validate(&bad, identity))
	}
	input = validInput()
	require.ErrorIs(t, service.Validate(&input, Identity{Role: "designer"}), buddy.ErrForbidden)
	require.ErrorIs(t, service.Validate(&input, Identity{Role: "staff"}), buddy.ErrForbidden)
	repository := Input{TemplateID: "repository", Version: 1, System: "Git", Key: "travel/service-api", Justification: "Исправить проверку дат бронирования", Permission: "write", Days: 30, Fields: map[string]string{"repository_url": "javascript:bad"}}
	require.Error(t, service.Validate(&repository, Identity{Role: "backend"}))
	repository.Fields["repository_url"] = "https://git.example/travel/service-api"
	require.NoError(t, service.Validate(&repository, Identity{Role: "backend"}))
}
func TestRequestsLifecycleAndIsolation(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	identity, err := s.Identity(ctx, "olga")
	require.NoError(t, err)
	require.Equal(t, "delivery", identity.Product)
	require.Equal(t, "analyst", identity.Role)
	_, err = s.Identity(ctx, "unknown")
	require.ErrorIs(t, err, buddy.ErrForbidden)
	catalog, err := s.GetCatalog(ctx, "olga")
	require.NoError(t, err)
	raw, _ := json.Marshal(catalog)
	require.Contains(t, string(raw), "delivery.orders_mart")
	require.NotContains(t, string(raw), "travel/service-api")
	require.NotContains(t, string(raw), `"id":"repository"`)
	request, err := s.Submit(ctx, "olga", validInput(), "operation-1", "agent")
	require.NoError(t, err)
	require.Equal(t, "submitted", request.Status)
	require.Equal(t, "agent", request.Origin)
	same, err := s.Submit(ctx, "olga", validInput(), "operation-1", "agent")
	require.NoError(t, err)
	require.Equal(t, request.ID, same.ID)
	duplicate, err := s.Submit(ctx, "olga", validInput(), "operation-2", "portal")
	require.NoError(t, err)
	require.Equal(t, request.ID, duplicate.ID)
	changed := validInput()
	changed.Days = 45
	_, err = s.Submit(ctx, "olga", changed, "operation-1", "agent")
	require.ErrorIs(t, err, ErrConflict)
	wrong := validInput()
	wrong.Key = "travel.orders_mart"
	_, err = s.Submit(ctx, "olga", wrong, "other", "portal")
	require.ErrorIs(t, err, buddy.ErrForbidden)
	_, err = s.Submit(ctx, "maria", validInput(), "other", "portal")
	require.ErrorIs(t, err, buddy.ErrForbidden)
	_, err = s.Submit(ctx, "manager", validInput(), "other", "portal")
	require.ErrorIs(t, err, buddy.ErrForbidden)
	records, err := s.List(ctx, "olga")
	require.NoError(t, err)
	require.Len(t, records, 1)
	for _, account := range []string{"manager", "sasha", "travel-manager", "mentor"} {
		records, err := s.List(ctx, account)
		require.NoError(t, err)
		require.Empty(t, records)
	}
	for _, action := range []string{"approved", "rejected"} {
		_, err = s.Decide(ctx, "manager", request.ID, action, "Рабочий комментарий")
		require.ErrorIs(t, err, buddy.ErrInvalidInput)
	}
	repository := Input{TemplateID: "repository", Version: 1, System: "Git", Key: "travel/service-api", Justification: "Исправить проверку дат бронирования", Permission: "write", Days: 30, Fields: map[string]string{"repository_url": "https://git.example/travel/service-api"}}
	r, err := s.Submit(ctx, "sasha", repository, "repo-1", "portal")
	require.NoError(t, err)
	_, err = s.Decide(ctx, "travel-manager", r.ID, "cancelled", "")
	require.ErrorIs(t, err, buddy.ErrNotFound)
	cancelled, err := s.Decide(ctx, "sasha", r.ID, "cancelled", "")
	require.NoError(t, err)
	require.Equal(t, "cancelled", cancelled.Status)
	repository.Fields["repository_url"] = "https://git.example/help/service-api"
	_, err = s.Submit(ctx, "sasha", repository, "repo-2", "portal")
	require.ErrorIs(t, err, buddy.ErrForbidden)
}
func TestConcurrentSubmissionAndKnowledge(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	results := make(chan Request, 6)
	failures := make(chan error, 6)
	for n := range 6 {
		go func(n int) {
			r, err := s.Submit(ctx, "olga", validInput(), fmt.Sprintf("concurrent-%d", n), "agent")
			results <- r
			failures <- err
		}(n)
	}
	ids := map[string]bool{}
	for range 6 {
		require.NoError(t, <-failures)
		ids[(<-results).ID] = true
	}
	require.Len(t, ids, 1)
	pages, err := s.Pages(ctx, "olga", "")
	require.NoError(t, err)
	require.Len(t, pages, 10)
	for _, p := range pages {
		require.True(t, p.Product == nil || *p.Product == "delivery")
		require.Empty(t, p.Body)
	}
	page, err := s.Page(ctx, "olga", "team-delivery")
	require.NoError(t, err)
	require.Contains(t, page.Body, "Анна Ким")
	_, err = s.Page(ctx, "olga", "team-travel")
	require.ErrorIs(t, err, buddy.ErrNotFound)
	matches, err := s.Search(ctx, "olga", "как запросить доступ DWH", 5)
	require.NoError(t, err)
	require.NotEmpty(t, matches["documents"])
	_, err = s.Search(ctx, "olga", "", 3)
	require.ErrorIs(t, err, buddy.ErrInvalidInput)
	_, err = s.Pages(ctx, "olga", strings.Repeat("a", 501))
	require.ErrorIs(t, err, buddy.ErrInvalidInput)
	require.NoError(t, s.EnsureSeed(ctx))
	pagesAgain, err := s.Pages(ctx, "olga", "")
	require.NoError(t, err)
	require.Len(t, pagesAgain, len(pages))
	for _, tool := range []string{"get_access_catalog", "get_access_requests"} {
		value, err := s.Tool(ctx, "olga", tool, map[string]any{}, "turn")
		require.NoError(t, err)
		require.NotEmpty(t, value["references"])
	}
	value, err := s.Tool(ctx, "olga", "get_knowledge_page", map[string]any{"page_id": "confluence:team-delivery"}, "turn")
	require.NoError(t, err)
	require.NotEmpty(t, value["page"])
	raw, _ := json.Marshal(validInput())
	var args map[string]any
	require.NoError(t, json.Unmarshal(raw, &args))
	value, err = s.Tool(ctx, "olga", "submit_access_request", args, "tool-turn")
	require.NoError(t, err)
	require.NotEmpty(t, value["request"])
	args["profile_id"] = "maria"
	_, err = s.Tool(ctx, "olga", "submit_access_request", args, "tool-turn")
	require.ErrorIs(t, err, buddy.ErrInvalidInput)
}
func TestPortalHTTP(t *testing.T) {
	s := testService(t)
	mux := http.NewServeMux()
	s.Register(mux, func(r *http.Request) (string, error) {
		account := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if account == "" {
			return "", buddy.ErrUnauthenticated
		}
		return account, nil
	})
	call := func(method, path, account, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if account != "" {
			r.Header.Set("Authorization", "Bearer "+account)
		}
		r.Header.Set("Idempotency-Key", "http-test")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		require.Equal(t, status, w.Code, w.Body.String())
		return w
	}
	call("GET", "/api/v1/portal-access/catalog", "", "", 401)
	call("GET", "/api/v1/portal-access/catalog", "olga", "", 200)
	call("GET", "/api/v1/confluence/pages", "olga", "", 200)
	call("GET", "/api/v1/confluence/pages/team-delivery", "olga", "", 200)
	call("GET", "/api/v1/confluence/pages/team-travel", "olga", "", 404)
	call("POST", "/api/v1/portal-access/requests", "olga", `{"profile_id":"maria"}`, 400)
	raw, _ := json.Marshal(validInput())
	w := call("POST", "/api/v1/portal-access/requests", "olga", string(raw), 200)
	var request Request
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &request))
	require.JSONEq(t, "[]", call("GET", "/api/v1/portal-access/requests", "manager", "", 200).Body.String())
	call("POST", "/api/v1/portal-access/requests/"+request.ID+"/decision", "manager", `{"action":"rejected","note":"Уточните основание"}`, 400)
	call("POST", "/api/v1/portal-access/requests/"+request.ID+"/decision", "manager", `{"action":"approved","note":""}`, 400)
	call("POST", "/api/v1/portal-access/requests/"+request.ID+"/decision", "olga", `{"action":"cancelled","note":""}`, 200)
	call("POST", "/api/v1/portal-access/requests/"+request.ID+"/decision", "olga", `{"action":"cancelled","note":""}`, 409)
	s.DB.Close()
	call("GET", "/api/v1/portal-access/catalog", "olga", "", 503)
}

func TestCancellationIsNotLimitedToLatestHundredRequests(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	first, err := s.Submit(ctx, "olga", validInput(), "old-request", "portal")
	require.NoError(t, err)
	_, err = s.DB.Exec(ctx, `INSERT INTO portal_access_requests(profile_id,product_id,template_id,resource_key,permission,scope_key,input,operation_key,origin,created_at)
 SELECT profile_id,product_id,template_id,resource_key,permission,'history-'||n,input,'history-'||n,origin,created_at+interval '1 second'
 FROM portal_access_requests CROSS JOIN generate_series(1,101) n WHERE id::text=$1`, first.ID)
	require.NoError(t, err)
	recent, err := s.List(ctx, "olga")
	require.NoError(t, err)
	require.Len(t, recent, 100)
	result, err := s.Decide(ctx, "olga", first.ID, "cancelled", "")
	require.NoError(t, err)
	require.Equal(t, "cancelled", result.Status)
}

func TestMigrationRollbackPreservesProfilesAndCanBeReapplied(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	for _, name := range []string{"../../migrations/09_access_knowledge.down.sql", "../../migrations/09_access_knowledge.up.sql"} {
		raw, err := os.ReadFile(name)
		require.NoError(t, err)
		_, err = s.DB.Exec(ctx, string(raw))
		require.NoError(t, err)
	}
	require.NoError(t, s.EnsureSeed(ctx))
	identity, err := s.Identity(ctx, "manager")
	require.NoError(t, err)
	require.False(t, identity.CanReview)
}

func TestAccessStatusMigrationUpdatesExistingGuides(t *testing.T) {
	s := testService(t)
	ctx := context.Background()
	for _, direction := range []string{"down", "up"} {
		raw, err := os.ReadFile("../../migrations/10_access_status_guides." + direction + ".sql")
		require.NoError(t, err)
		_, err = s.DB.Exec(ctx, string(raw))
		require.NoError(t, err)
	}
	guide, err := s.Page(ctx, "olga", "guide-status")
	require.NoError(t, err)
	require.Equal(t, "Статусы заявок", guide.Title)
	require.Contains(t, guide.Body, "## Отправлено")
	require.NotContains(t, guide.Body, "может принять решение")
	require.Equal(t, 3, guide.Version)

	team, err := s.Page(ctx, "olga", "team-delivery")
	require.NoError(t, err)
	require.NotContains(t, team.Body, "приоритеты и доступы")
	require.Equal(t, 3, team.Version)
}
