package ai

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/portal"
	"github.com/dureppa/ai-buddy/web/backend/internal/store"
	"github.com/dureppa/ai-buddy/web/backend/internal/worktools"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestInternGuidesThroughMCPBridge(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	db, err := pgxpool.New(t.Context(), dsn)
	require.NoError(t, err)
	defer db.Close()
	b, _ := newBridge(t, "http://127.0.0.1:9876")
	b.Store = store.New(db)
	b.Portal = portal.New(db)
	b.Portal.KnowledgeURL = "https://knowledge.example"
	require.NoError(t, b.Portal.EnsureSeed(t.Context()))
	if origin := os.Getenv("TEST_CONFLUENCE_URL"); origin != "" {
		b.Portal.ExternalKnowledge, err = portal.NewKnowledgeClient(origin, os.Getenv("TEST_CONFLUENCE_DELEGATION_SECRET"))
		require.NoError(t, err)
	}
	catalog, err := worktools.Open(t.Context(), db, dsn)
	require.NoError(t, err)
	defer catalog.Close()
	b.WorkTools = catalog
	mux := http.NewServeMux()
	b.Register(mux)

	token := func(profile string) string {
		value, err := b.token(profile, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "mcp-resource")
		require.NoError(t, err)
		return value
	}
	cases := []struct {
		query  string
		guides []string
	}{
		{"Какая задача текущая и как отметить чек-лист стажёра?", []string{"checklist"}},
		{"Как описать блокер наставнику?", []string{"mentor"}},
		{"Как договориться о результате первой рабочей задачи?", []string{"first-result"}},
		{"Где найти назначенные задачи и доску Jira?", []string{"jira-board"}},
		{"Как подтвердить черновик при создании задачи Jira?", []string{"jira-create"}},
		{"Как исправить конфликт версий 409 в Jira?", []string{"jira-update"}},
		{"Как запросить доступ к рабочему пространству BI или витрине DWH?", []string{"access-bi"}},
		{"Что делать, если ключ ресурса отсутствует в каталоге доступов?", []string{"access-missing"}},
		{"Как проверить номер заявки после сетевой ошибки?", []string{"access-retry"}},
		{"Как найти узкое место воронки в Redash?", []string{"redash"}},
		{"Как проверить сохранённую выборку Trino?", []string{"trino"}},
		{"Как проверить всплеск ошибок в Grafana после релиза?", []string{"grafana"}},
		{"Как подготовить изменение в Bitbucket к ревью?", []string{"bitbucket"}},
		{"Где сверить окружение и версию релиза в PaaS?", []string{"release"}},
		{"Что означает отсутствие фикстуры VIN в Postman?", []string{"postman"}},
		{"Как описать воспроизводимый дефект по прогону TMS?", []string{"tms"}},
		{"Как передать макет Figma на дизайн-ревью?", []string{"design-review"}},
		{"Какие этапы воронки DEL-1 можно сверить между Redash и Trino?", []string{"delivery-funnel", "trino"}},
		{"Как связать рост ошибок booking-api в Grafana с версией релиза TRV-1 в PaaS?", []string{"travel-release", "grafana"}},
	}
	for _, tc := range cases {
		t.Run(tc.query, func(t *testing.T) {
			profile := "olga"
			if strings.Contains(tc.query, "TRV-1") {
				profile = "sasha"
			}
			auth := token(profile)
			payload, err := json.Marshal(map[string]any{"query": tc.query, "limit": 5})
			require.NoError(t, err)
			resp := call(mux, "POST", "/internal/v1/ai/knowledge/search", auth, string(payload))
			require.Equal(t, 200, resp.Code, resp.Body.String())
			for _, guide := range tc.guides {
				id := "intern-" + guide
				link := "https://knowledge.example?page=" + id
				require.Contains(t, resp.Body.String(), link)
				page := call(mux, "POST", "/internal/v1/ai/knowledge/page", auth, `{"page_id":"confluence:`+id+`"}`)
				require.Equal(t, 200, page.Code, page.Body.String())
				require.Contains(t, page.Body.String(), link)
				require.Contains(t, page.Body.String(), `"body":"## `)
			}
		})
	}
	for _, tc := range []struct{ profile, id string }{{"sasha", "intern-delivery-funnel"}, {"olga", "intern-travel-release"}} {
		auth := token(tc.profile)
		resp := call(mux, "POST", "/internal/v1/ai/knowledge/search", auth, `{"query":"DEL-1 TRV-1 Grafana Redash","limit":5}`)
		require.Equal(t, 200, resp.Code)
		require.NotContains(t, resp.Body.String(), tc.id)
		require.Equal(t, 404, call(mux, "POST", "/internal/v1/ai/knowledge/page", auth, `{"page_id":"`+tc.id+`"}`).Code)
	}
}
