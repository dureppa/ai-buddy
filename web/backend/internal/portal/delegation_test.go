package portal

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPortalDelegatesConfiguredOperations(t *testing.T) {
	s := testService(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Contains(t, r.Header.Get("Authorization"), "Bearer ")
		switch r.Method + " " + r.URL.Path {
		case "GET /api/v1/portal-access/catalog":
			respond(w, 200, map[string]any{"templates": []string{"external"}})
		case "GET /api/v1/portal-access/requests":
			respond(w, 200, []Request{{ID: "external", Status: "submitted"}})
		case "POST /api/v1/portal-access/requests":
			var in Input
			assert.NoError(t, json.NewDecoder(r.Body).Decode(&in))
			assert.Equal(t, "delivery.orders_mart", in.Key)
			assert.Equal(t, "key", r.Header.Get("Idempotency-Key"))
			assert.Equal(t, "agent", r.Header.Get("X-Access-Origin"))
			respond(w, 200, Request{ID: "external", Status: "submitted"})
		case "POST /api/v1/portal-access/requests/external/decision":
			var in map[string]string
			assert.NoError(t, json.NewDecoder(r.Body).Decode(&in))
			assert.Equal(t, "cancelled", in["action"])
			respond(w, 200, Request{ID: "external", Status: "cancelled"})
		case "GET /api/v1/confluence/pages":
			assert.Equal(t, "доступ и задачи", r.URL.Query().Get("query"))
			respond(w, 200, []Page{{ID: "remote", Title: "Внешняя страница"}})
		case "GET /api/v1/confluence/pages/remote":
			respond(w, 200, Page{ID: "remote", Body: "Инструкция"})
		case "GET /api/v1/confluence/search":
			assert.Equal(t, "доступ", r.URL.Query().Get("query"))
			respond(w, 200, []Page{{ID: "remote", Title: "Внешняя страница", Body: strings.Repeat("ж", 1201)}})
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	secret := strings.Repeat("k", 32)
	var err error
	s.ExternalAccess, err = NewAccessClient(server.URL, secret)
	require.NoError(t, err)
	s.ExternalKnowledge, err = NewKnowledgeClient(server.URL, secret)
	require.NoError(t, err)
	ctx := t.Context()

	catalog, err := s.GetCatalog(ctx, "olga")
	require.NoError(t, err)
	require.Equal(t, []any{"external"}, catalog["templates"])
	list, err := s.List(ctx, "olga")
	require.NoError(t, err)
	require.Equal(t, "external", list[0].ID)
	created, err := s.Submit(ctx, "olga", validInput(), "key", "agent")
	require.NoError(t, err)
	require.Equal(t, "submitted", created.Status)
	decided, err := s.Decide(ctx, "olga", created.ID, "cancelled", "")
	require.NoError(t, err)
	require.Equal(t, "cancelled", decided.Status)
	pages, err := s.Pages(ctx, "olga", "доступ и задачи")
	require.NoError(t, err)
	require.Equal(t, "remote", pages[0].ID)
	page, err := s.Page(ctx, "olga", "remote")
	require.NoError(t, err)
	require.Equal(t, "Инструкция", page.Body)
	for _, limit := range []int{1, 5} {
		result, err := s.Search(ctx, "olga", "доступ", limit)
		require.NoError(t, err)
		docs := result["documents"].([]any)
		require.NotEmpty(t, docs)
		require.LessOrEqual(t, len(docs), limit)
		require.Contains(t, docs[0].(map[string]any)["source"].(map[string]any)["url"], "page=remote")
		require.Less(t, len([]rune(docs[0].(map[string]any)["excerpt"].(string))), 1201)
	}
	_, err = s.Search(ctx, "unknown", "доступ", 5)
	require.ErrorIs(t, err, buddy.ErrForbidden)
}

func TestDelegatedClientFailures(t *testing.T) {
	secret := strings.Repeat("k", 32)
	_, err := NewAccessClient("ftp://example.invalid", secret)
	require.ErrorContains(t, err, "ACCESS_API_URL")
	_, err = NewKnowledgeClient("http://localhost:1234", "short")
	require.ErrorContains(t, err, "CONFLUENCE_DELEGATION_SECRET")

	for _, tc := range []struct {
		name string
		code int
		body string
		want error
	}{
		{"bad request", 400, "", buddy.ErrInvalidInput},
		{"unauthenticated", 401, "", buddy.ErrUnauthenticated},
		{"forbidden", 403, "", buddy.ErrForbidden},
		{"not found", 404, "", buddy.ErrNotFound},
		{"upstream down", 503, "", buddy.ErrUnavailable},
		{"malformed", 200, "{", buddy.ErrUnavailable},
		{"redirect", 307, "", buddy.ErrUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if tc.code == 307 {
					w.Header().Set("Location", "/unexpected")
				}
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			access, err := NewAccessClient(server.URL, secret)
			require.NoError(t, err)
			knowledge, err := NewKnowledgeClient(server.URL, secret)
			require.NoError(t, err)
			_, err = access.Catalog(t.Context(), "olga")
			require.ErrorIs(t, err, tc.want)
			_, err = knowledge.Pages(t.Context(), "olga", "")
			require.ErrorIs(t, err, tc.want)

			_, err = knowledge.Page(t.Context(), "olga", "..")
			require.ErrorIs(t, err, buddy.ErrInvalidInput)
			server.Close()
			_, err = access.List(t.Context(), "olga")
			require.ErrorIs(t, err, buddy.ErrUnavailable)
			_, err = knowledge.Search(t.Context(), "olga", "доступ", 2)
			require.ErrorIs(t, err, buddy.ErrUnavailable)
		})
	}
	t.Run("oversized search result", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			respond(w, 200, []Page{{ID: "a"}, {ID: "b"}})
		}))
		defer server.Close()
		knowledge, err := NewKnowledgeClient(server.URL, secret)
		require.NoError(t, err)
		_, err = knowledge.Search(t.Context(), "olga", "доступ", 1)
		require.ErrorIs(t, err, buddy.ErrUnavailable)
	})
}

func TestPortalRejectsInvalidAndOutOfScopeRequests(t *testing.T) {
	s := testService(t)
	mux := http.NewServeMux()
	s.Register(mux, func(r *http.Request) (string, error) {
		return r.Header.Get("X-Test-Account"), nil
	})
	for _, tt := range []struct {
		name, method, path, profile, body string
		status                            int
	}{
		{"unknown account knowledge", "GET", "/api/v1/confluence/pages", "unknown", "", 403},
		{"unknown account page", "GET", "/api/v1/confluence/pages/team-delivery", "unknown", "", 403},
		{"unknown account requests", "GET", "/api/v1/portal-access/requests", "unknown", "", 403},
		{"body over limit", "POST", "/api/v1/portal-access/requests", "olga", strings.Repeat(" ", 16385), 400},
		{"trailing JSON", "POST", "/api/v1/portal-access/requests", "olga", "{}{}", 400},
		{"malformed decision", "POST", "/api/v1/portal-access/requests/unknown/decision", "olga", "not-json", 400},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			r.Header.Set("X-Test-Account", tt.profile)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			require.Equal(t, tt.status, w.Code, w.Body.String())
		})
	}

	for _, tool := range []string{"get_access_catalog", "get_access_requests", "get_knowledge_page"} {
		_, err := s.Tool(t.Context(), "olga", tool, map[string]any{"profile_id": "sasha"}, "turn")
		require.ErrorIs(t, err, buddy.ErrInvalidInput)
	}
	_, err := s.Tool(t.Context(), "olga", "get_knowledge_page", map[string]any{"page_id": "confluence:team-travel"}, "turn")
	require.ErrorIs(t, err, buddy.ErrNotFound)
	_, err = s.Tool(t.Context(), "olga", "unknown", nil, "turn")
	require.ErrorIs(t, err, buddy.ErrNotFound)

	_, err = s.GetCatalog(t.Context(), "unknown")
	require.ErrorIs(t, err, buddy.ErrForbidden)
	_, err = s.Tool(t.Context(), "unknown", "get_access_catalog", nil, "turn")
	require.ErrorIs(t, err, buddy.ErrForbidden)
	_, err = s.Tool(t.Context(), "unknown", "get_access_requests", nil, "turn")
	require.ErrorIs(t, err, buddy.ErrForbidden)
	_, err = s.Submit(t.Context(), "unknown", validInput(), "id", "portal")
	require.ErrorIs(t, err, buddy.ErrForbidden)
	_, err = s.Submit(t.Context(), "olga", validInput(), "", "portal")
	require.ErrorIs(t, err, buddy.ErrInvalidInput)
	_, err = s.Decide(t.Context(), "unknown", "external", "cancelled", "")
	require.ErrorIs(t, err, buddy.ErrForbidden)
}
