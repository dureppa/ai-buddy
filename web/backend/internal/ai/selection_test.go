package ai

import (
	"context"
	"encoding/json"
	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/dureppa/ai-buddy/web/backend/internal/portal"
	"github.com/dureppa/ai-buddy/web/backend/internal/serviceactions"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSelectionIsForwardedWithReadOnlyDelegation(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&received))
		write(w, 200, map[string]any{"request_id": received["request_id"], "conversation_id": received["conversation_id"], "reply": map[string]any{"text": "Ответ", "references": []any{}}})
	}))
	defer server.Close()
	b, _ := newBridge(t, server.URL)
	_, err := b.Ask(context.Background(), "olga", buddy.ChatMessage{Text: "Оформи доступ", PageURL: "https://service.example/", Selection: &buddy.Selection{Text: "Фрагмент", Title: "Страница"}})
	require.NoError(t, err)
	claims, err := b.claims(received["delegation_token"].(string), "mcp-delegation")
	require.NoError(t, err)
	require.True(t, claims.ReadOnly)
	require.False(t, claims.AccessIntent)
	require.Contains(t, received["page_context"], "selection")
	b.Actions = &serviceactions.Service{}
	b.Portal = &portal.Service{}
	mux := http.NewServeMux()
	b.Register(mux)
	token, err := b.token("olga", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "mcp-delegation", true, true)
	require.NoError(t, err)
	response := call(mux, "POST", "/internal/v1/ai/context/resolve", b.AdapterToken, `{"delegation_token":"`+token+`"}`)
	require.Equal(t, 200, response.Code)
	var data struct {
		Token string   `json:"api_token"`
		Tools []string `json:"allowed_tools"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &data))
	require.Contains(t, data.Tools, "get_service_context")
	require.NotContains(t, data.Tools, "prepare_service_action")
	require.NotContains(t, data.Tools, "submit_access_request")
	resource, err := b.claims(data.Token, "mcp-resource")
	require.NoError(t, err)
	require.True(t, resource.ReadOnly)
	for _, path := range []string{"/internal/v1/ai/service-actions/prepare", "/internal/v1/ai/access/requests"} {
		require.Equal(t, 403, call(mux, "POST", path, data.Token, `{}`).Code)
	}
}
