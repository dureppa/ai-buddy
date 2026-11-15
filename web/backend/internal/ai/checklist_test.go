package ai

import (
	"context"
	"encoding/json"
	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChecklistForwardingDoesNotGrantOrRemoveActionPermissions(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&received))
		write(w, 200, map[string]any{"request_id": received["request_id"], "conversation_id": received["conversation_id"], "reply": map[string]any{"text": "Ответ", "references": []any{}}})
	}))
	defer server.Close()
	b, _ := newBridge(t, server.URL)
	for _, selected := range []bool{false, true} {
		message := buddy.ChatMessage{Text: "Оформи доступ к Grafana на 30 дней для стажировки", PageURL: "https://buddy.example/", Checklist: &buddy.ChecklistContext{Status: "in_progress", Task: &buddy.SelectionResource{Kind: "task", ID: "local-role-task", Label: "Мой пункт"}}}
		if selected {
			message.Selection = &buddy.Selection{Text: "Пункт", Title: "Адаптация"}
		}
		_, err := b.Ask(context.Background(), "olga", message)
		require.NoError(t, err)
		page := received["page_context"].(map[string]any)
		require.Equal(t, "local-role-task", page["checklist"].(map[string]any)["task"].(map[string]any)["id"])
		claims, err := b.claims(received["delegation_token"].(string), "mcp-delegation")
		require.NoError(t, err)
		require.Equal(t, selected, claims.ReadOnly)
		require.Equal(t, !selected, claims.AccessIntent)
	}
}
