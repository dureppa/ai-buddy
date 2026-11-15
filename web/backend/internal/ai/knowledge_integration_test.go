package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/dureppa/ai-buddy/web/backend/internal/portal"
	"github.com/dureppa/ai-buddy/web/backend/internal/store"
	"github.com/dureppa/ai-buddy/web/backend/internal/worktools"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestKnowledgeSearchCombinesAuthorizedSources(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	db, err := pgxpool.New(t.Context(), dsn)
	require.NoError(t, err)
	defer db.Close()

	catalog, err := worktools.Open(t.Context(), db, dsn)
	require.NoError(t, err)
	defer catalog.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/demo/sessions":
			var input map[string]string
			assert.NoError(t, json.NewDecoder(r.Body).Decode(&input))
			assert.Equal(t, "olga", input["profile_id"])
			write(w, 200, map[string]string{"access_token": "jira-session", "profile_id": "olga"})
		case "/api/v1/me/issues":
			assert.Equal(t, "Bearer jira-session", r.Header.Get("Authorization"))
			write(w, 200, []map[string]string{{"id": "demo", "key": "DEL-1", "title": "Задача Jira",
				"board_id": "delivery", "space_id": "delivery", "description": "Задача команды"}})
		case "/api/v1/confluence/search":
			write(w, 200, []portal.Page{{ID: "jira-rules", Title: "Инструкция Jira", Body: "Как работать с задачами"}})
		case "/api/v1/portal-access/catalog":
			write(w, 403, nil)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	b, _ := newBridge(t, server.URL)
	b.Store = store.New(db)
	b.Portal = portal.New(db)
	b.Portal.ExternalKnowledge, err = portal.NewKnowledgeClient(server.URL, strings.Repeat("k", 32))
	require.NoError(t, err)
	b.Portal.ExternalAccess, err = portal.NewAccessClient(server.URL, strings.Repeat("a", 32))
	require.NoError(t, err)
	b.WorkTools = catalog
	b.JiraURL = server.URL
	b.PublicJiraURL = "https://jira.example"
	b.DemoMode = true

	mux := http.NewServeMux()
	b.Register(mux)
	token, err := b.token("olga", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "mcp-resource")
	require.NoError(t, err)

	const path = "/internal/v1/ai/knowledge/search"
	for _, bad := range []string{`{"query":"Jira","limit":1.5}`, `{"query":"Jira","limit":3}{}`, `{"query":"Jira","limit":3,"extra":true}`} {
		require.Equal(t, 400, call(mux, "POST", path, token, bad).Code)
	}
	resp := call(mux, "POST", path, token, `{"query":"Jira","limit":3}`)
	require.Equal(t, 200, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "DEL-1")
	require.Contains(t, resp.Body.String(), "jira-rules")
	resp = call(mux, "POST", path, token, `{"query":"Где посмотреть воронку?","limit":2}`)
	require.Equal(t, 200, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "delivery-funnel")

	resp = call(mux, "GET", "/internal/v1/ai/access/catalog", token, "")
	require.Equal(t, 403, resp.Code, resp.Body.String())
	ghost, err := b.token("ghost", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "mcp-resource")
	require.NoError(t, err)
	require.Equal(t, 403, call(mux, "POST", path, ghost, `{"query":"Jira","limit":1}`).Code)
	require.Equal(t, 401, call(mux, "POST", path, "", `{"query":"Jira","limit":1}`).Code)
}

func TestChatAddsScheduleContextForScheduleQuestion(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/internal/v1/turns":
			var payload map[string]any
			assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
			assert.Contains(t, payload, "hr_today")
			write(w, 200, map[string]any{"request_id": payload["request_id"], "conversation_id": payload["conversation_id"], "reply": map[string]string{"text": "Ответ"}})
		default:
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer server.Close()
	b, _ := newBridge(t, server.URL)
	b.AbsencesURL = server.URL
	b.HRSecret = strings.Repeat("h", 32)
	reply, err := b.Ask(t.Context(), "olga", buddy.ChatMessage{Text: "Кто сегодня в отпуске?"})
	require.NoError(t, err)
	require.Equal(t, "Ответ", reply.Text)
	require.NotNil(t, reply.References)
	require.Empty(t, reply.References)
}
