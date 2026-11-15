package ai

import (
	"context"
	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

type navigationRepo struct{ fakeRepo }

func (navigationRepo) ReadAI(_ context.Context, _ string, _ string, args map[string]any) (map[string]any, error) {
	id, ok := args["task_id"].(string)
	if !ok || id == "ghost" {
		return nil, buddy.ErrNotFound
	}
	return map[string]any{"task_id": id, "title": "Задание", "guidance": "Инструкция", "action_url": nil, "references": []any{map[string]any{"id": "task:" + id, "url": "/onboarding", "title": "Задание"}}}, nil
}
func TestTaskLinksUseServiceOrSpecificTaskPage(t *testing.T) {
	b, _ := newBridge(t, "http://127.0.0.1:8001")
	for _, tc := range []struct{ task, action, want string }{
		{"papers", "/resources?article=documents", b.PublicDocumentsURL}, {"documents", "", b.PublicDocumentsURL}, {"consent-news", "", b.PublicConsentURL}, {"events", "", b.PublicEventsURL}, {"product", "/resources?article=product", "/product-guide"}, {"intro", "", "/team"}, {"team-meet", "", "/team"}, {"access", "", "/tools"}, {"equipment", "/resources?article=equipment", "/onboarding/tasks/equipment"}, {"custom", "", "/onboarding/tasks/custom"}, {"custom", "https://docs.example/guide?page=1#step", "https://docs.example/guide?page=1#step"}, {"custom", "https://docs.example/resources?article=guide", "https://docs.example/resources?article=guide"},
		{"custom", "javascript:alert(1)", "/onboarding/tasks/custom"}, {"custom", "//evil.example", "/onboarding/tasks/custom"}, {"custom", "https://user:pass@example.com", "/onboarding/tasks/custom"}, {"custom", "/\\evil.example", "/onboarding/tasks/custom"},
	} {
		t.Run(tc.task+tc.action, func(t *testing.T) {
			ref := map[string]any{"id": "task:" + tc.task, "url": "/onboarding"}
			other := map[string]any{"id": "unrelated", "url": "/team"}
			data := map[string]any{"action_url": tc.action, "references": []any{ref, other}}
			b.taskLinks(tc.task, data)
			require.Equal(t, tc.want, data["action_url"])
			require.Equal(t, tc.want, ref["url"])
			require.Equal(t, "/team", other["url"])
		})
	}
	b.PublicDocumentsURL = ""
	data := map[string]any{}
	b.taskLinks("papers", data)
	require.Equal(t, "/onboarding/tasks/papers", data["action_url"])
}
func TestTaskRouteReturnsCorrectSourceDestination(t *testing.T) {
	b, _ := newBridge(t, "http://127.0.0.1:8001")
	b.Store = &navigationRepo{}
	mux := http.NewServeMux()
	b.Register(mux)
	token, err := b.token("olga", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "mcp-resource")
	require.NoError(t, err)
	r := call(mux, "POST", "/internal/v1/ai/onboarding/task-context", token, `{"task_id":"papers"}`)
	require.Equal(t, 200, r.Code)
	require.Contains(t, r.Body.String(), `"url":"`+b.PublicDocumentsURL+`"`)
	require.NotContains(t, r.Body.String(), `"url":"/onboarding"`)
}
func TestPapersEvidenceReadsDocumentsAndUnknownEvidenceDoesNotLinkConsents(t *testing.T) {
	reads := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads++
		require.Equal(t, "/api/v1/me/documents", r.URL.Path)
		write(w, 200, []any{map[string]any{"id": "papers", "title": "Памятка", "text": "Учебное чтение", "done": true}})
	}))
	defer s.Close()
	b, _ := newBridge(t, "http://127.0.0.1:8001")
	b.Store = &navigationRepo{}
	b.DocumentsURL = s.URL
	b.HRSecret = "synthetic-hr-secret-long-enough-to-sign"
	b.Client = s.Client()
	for _, id := range []string{"papers", "documents"} {
		data, err := b.evidence(context.Background(), "olga", map[string]any{"task_id": id})
		require.NoError(t, err)
		require.True(t, data["items"].([]any)[0].(map[string]any)["confirmed"].(bool))
		require.Equal(t, b.PublicDocumentsURL, data["references"].([]any)[0].(map[string]any)["url"])
	}
	data, err := b.evidence(context.Background(), "olga", map[string]any{"task_id": "equipment"})
	require.NoError(t, err)
	require.Empty(t, data["items"])
	require.Equal(t, "/onboarding/tasks/equipment", data["references"].([]any)[0].(map[string]any)["url"])
	require.Equal(t, 2, reads)
	_, err = b.evidence(context.Background(), "olga", map[string]any{"task_id": "ghost"})
	require.ErrorIs(t, err, buddy.ErrNotFound)
}

type historyNavigationRepo struct {
	navigationRepo
	mode  string
	reads int
}

func (r *historyNavigationRepo) Conversation(context.Context, string, string) ([]buddy.HistoryMessage, error) {
	if r.mode == "owner-error" {
		return nil, buddy.ErrForbidden
	}
	return []buddy.HistoryMessage{{Role: "assistant", Content: "Твой шаг", References: []buddy.Reference{{Title: "Подписать документы", URL: "/onboarding"}, {Title: "Личный чек-лист", URL: "/onboarding"}, {Title: "Подписать документы", URL: "/team"}, {Title: "Подписать документы", URL: "/onboarding"}}}}, nil
}
func (r *historyNavigationRepo) ReadAI(ctx context.Context, profile, tool string, args map[string]any) (map[string]any, error) {
	r.reads++
	if profile != "olga" {
		return nil, buddy.ErrForbidden
	}
	if tool == "get_onboarding_progress" {
		if r.mode == "progress-error" {
			return nil, buddy.ErrUnavailable
		}
		tasks := []any{map[string]any{"id": "papers", "title": "Подписать документы"}}
		if r.mode == "ambiguous" {
			tasks = append(tasks, map[string]any{"id": "other", "title": "Подписать документы"})
		}
		return map[string]any{"tasks": tasks}, nil
	}
	if r.mode == "context-error" {
		return nil, buddy.ErrNotFound
	}
	return r.navigationRepo.ReadAI(ctx, profile, tool, args)
}
func TestOwnedConversationRepairsKnownTaskCardsWithoutGuessing(t *testing.T) {
	for _, mode := range []string{"ok", "owner-error", "progress-error", "context-error", "ambiguous"} {
		t.Run(mode, func(t *testing.T) {
			b, _ := newBridge(t, "http://127.0.0.1:8001")
			repo := &historyNavigationRepo{mode: mode}
			b.Store = repo
			messages, err := b.Conversation(context.Background(), "olga", "owned")
			if mode == "owner-error" {
				require.ErrorIs(t, err, buddy.ErrForbidden)
				require.Zero(t, repo.reads)
				return
			}
			require.NoError(t, err)
			refs := messages[0].References
			want := "/onboarding"
			if mode == "ok" {
				want = b.PublicDocumentsURL
				require.Equal(t, 2, repo.reads)
			}
			require.Equal(t, want, refs[0].URL)
			require.Equal(t, want, refs[3].URL)
			require.Equal(t, "/onboarding", refs[1].URL)
			require.Equal(t, "/team", refs[2].URL)
		})
	}
}
