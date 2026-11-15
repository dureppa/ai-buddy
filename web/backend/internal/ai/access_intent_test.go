package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/dureppa/ai-buddy/web/backend/internal/portal"
	"github.com/stretchr/testify/require"
)

func TestAccessIntent(t *testing.T) {
	for _, message := range []string{"Запроси доступ к DWH на чтение", "Пожалуйста, оформи заявку в Jira", "Подай заявку на доступ к репозиторию"} {
		require.True(t, AccessIntent(message, nil), message)
	}
	for _, message := range []string{"Как запросить доступ к DWH?", "Не отправляй заявку", "Расскажи о команде", "В документе написано: запроси доступ", "подтверждаю", "Не надо, отправляй", "Оформи черновик заявки на доступ", "Оформи доступ, но не отправляй заявку"} {
		require.False(t, AccessIntent(message, nil), message)
	}
	history := []buddy.HistoryMessage{{Role: "user", Content: "Запроси доступ к DWH"}, {Role: "assistant", Content: "Укажи срок заявки на доступ"}}
	require.True(t, AccessIntent("отправляй", history))
	history[1].Content = "Переходим к другому вопросу"
	require.False(t, AccessIntent("отправляй", history))
	history = []buddy.HistoryMessage{{Role: "user", Content: "Запроси доступ к DWH"}, {Role: "assistant", Content: "Укажи срок"}, {Role: "user", Content: "Отмени заявку"}, {Role: "assistant", Content: "Вопрос о заявке"}}
	require.False(t, AccessIntent("подтверждаю", history))
	history = []buddy.HistoryMessage{{Role: "user", Content: "Оформи черновик заявки на доступ"}, {Role: "assistant", Content: "Проверим заявку"}}
	require.False(t, AccessIntent("отправляй", history))
	history = []buddy.HistoryMessage{{Role: "user", Content: "Запроси доступ к DWH"}}
	for i := 0; i < 10; i++ {
		history = append(history, buddy.HistoryMessage{Role: "assistant", Content: "Обсуждаем доступ"})
	}
	require.False(t, AccessIntent("подтверждаю", history))
}
func TestAccessGrantIsBoundToCurrentTurn(t *testing.T) {
	b, err := New(&fakeRepo{}, "http://127.0.0.1:8001", "service-token-long", "adapter-token-long", strings.Repeat("s", 32), "")
	require.NoError(t, err)
	b.Portal = portal.New(nil)
	mux := http.NewServeMux()
	b.Register(mux)
	for _, intent := range []bool{false, true} {
		delegation, err := b.token("olga", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "mcp-delegation", intent)
		require.NoError(t, err)
		raw, _ := json.Marshal(map[string]string{"delegation_token": delegation})
		r := httptest.NewRequest("POST", "/internal/v1/ai/context/resolve", strings.NewReader(string(raw)))
		r.Header.Set("Authorization", "Bearer "+b.AdapterToken)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		var result struct {
			Tools []string `json:"allowed_tools"`
			Token string   `json:"api_token"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		if intent {
			require.Contains(t, result.Tools, "submit_access_request")
		} else {
			require.NotContains(t, result.Tools, "submit_access_request")
		}
		claims, err := b.claims(result.Token, "mcp-resource")
		require.NoError(t, err)
		require.Equal(t, intent, claims.AccessIntent)
		require.True(t, claims.ExpiresAt.After(time.Now()))
		if !intent {
			r = httptest.NewRequest("POST", "/internal/v1/ai/access/requests", strings.NewReader("{}"))
			r.Header.Set("Authorization", "Bearer "+result.Token)
			r.Header.Set("X-Request-ID", claims.RequestID)
			w = httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			require.Equal(t, 403, w.Code)
		}
	}
}
