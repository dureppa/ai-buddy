package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
	"github.com/stretchr/testify/require"
)

type liveAssistant struct{}

func (liveAssistant) Ask(context.Context, string, buddy.ChatMessage) (buddy.ChatReply, error) {
	return buddy.ChatReply{Kind: "answer", Text: "Ответ"}, nil
}
func (liveAssistant) Conversation(_ context.Context, _ string, id string) ([]buddy.HistoryMessage, error) {
	if id == "missing" {
		return nil, buddy.ErrNotFound
	}
	return []buddy.HistoryMessage{{Role: "assistant", Content: "Ответ"}}, nil
}
func (liveAssistant) Review(context.Context, string) (buddy.TaskReview, error) {
	return buddy.TaskReview{State: "awaiting_review"}, nil
}
func (liveAssistant) SubmitReview(_ context.Context, _ string, answer string) (buddy.TaskReview, error) {
	if answer == "" {
		return buddy.TaskReview{}, buddy.ErrInvalidInput
	}
	return buddy.TaskReview{State: "awaiting_review"}, nil
}
func TestChatHistoryAndReviewHTTP(t *testing.T) {
	api, token := testAPI()
	api.chat = buddy.NewChat(liveAssistant{})
	api.WithInternalRoutes(func(m *http.ServeMux) {
		m.HandleFunc("GET /internal/test", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	})
	for _, tt := range []struct {
		method, path, body string
		status             int
	}{{"POST", "/api/v1/chat/messages", `{"text":"hi"}`, 200}, {"GET", "/api/v1/chat/conversations/current", "", 200}, {"GET", "/api/v1/chat/conversations/missing", "", 404}, {"GET", "/api/v1/onboarding/consent-review", "", 200}, {"POST", "/api/v1/onboarding/consent-review", `{"answer":"Тест"}`, 200}, {"POST", "/api/v1/onboarding/consent-review", `{"answer":""}`, 400}, {"POST", "/api/v1/onboarding/consent-review", `{bad}`, 400}, {"GET", "/internal/test", "", 204}} {
		require.Equal(t, tt.status, doRequest(api, token, tt.method, tt.path, tt.body, true).Code)
	}
}
