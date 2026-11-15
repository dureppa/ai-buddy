package buddy

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type connectedAssistant struct{ message ChatMessage }

func (a *connectedAssistant) Ask(_ context.Context, profile string, msg ChatMessage) (ChatReply, error) {
	a.message = msg
	return ChatReply{Kind: "answer", Text: profile}, nil
}
func (a *connectedAssistant) Conversation(context.Context, string, string) ([]HistoryMessage, error) {
	return []HistoryMessage{{Role: "assistant", Content: "Ответ"}}, nil
}
func (a *connectedAssistant) Review(context.Context, string) (TaskReview, error) {
	return TaskReview{State: "awaiting_review"}, nil
}
func (a *connectedAssistant) SubmitReview(context.Context, string, string) (TaskReview, error) {
	return TaskReview{State: "awaiting_review"}, nil
}
func TestChatBoundaryAndOptionalCapabilities(t *testing.T) {
	ctx := context.Background()
	assistant := &connectedAssistant{}
	chat := NewChat(assistant)
	reply, err := chat.Ask(ctx, "olga", ChatMessage{Text: "Привет", PageURL: "https://example.com/page?secret=1#fragment"})
	require.NoError(t, err)
	require.Equal(t, "olga", reply.Text)
	require.Equal(t, "https://example.com/page", assistant.message.PageURL)
	for _, msg := range []ChatMessage{{Text: " "}, {Text: strings.Repeat("я", 4001)}, {Text: "hi", PageURL: "ftp://bad"}, {Text: "hi", PageURL: "https://user@host"}, {Text: "hi", PageURL: "https://host/\\bad"}, {Text: "hi", PageURL: "https://host/\n"}, {Text: "hi", PageURL: "https://"}} {
		_, err = chat.Ask(ctx, "olga", msg)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	history, err := chat.Conversation(ctx, "olga", "conversation")
	require.NoError(t, err)
	require.Len(t, history, 1)
	review, err := chat.Review(ctx, "olga")
	require.NoError(t, err)
	require.Equal(t, "awaiting_review", review.State)
	_, err = chat.SubmitReview(ctx, "olga", "Ответ")
	require.NoError(t, err)
	off := NewChat(UnavailableAssistant{})
	_, err = off.Ask(ctx, "olga", ChatMessage{Text: "hi"})
	require.ErrorIs(t, err, ErrUnavailable)
	_, err = off.Conversation(ctx, "olga", "id")
	require.ErrorIs(t, err, ErrUnavailable)
	_, err = off.Review(ctx, "olga")
	require.ErrorIs(t, err, ErrUnavailable)
	_, err = off.SubmitReview(ctx, "olga", "Ответ")
	require.ErrorIs(t, err, ErrUnavailable)
}

func TestKnowledgeSearchDayOffAliasKeepsQueryBounded(t *testing.T) {
	require.Contains(t, KnowledgeSearchQuery("Как оформить отгул?"), "отпуск")
	original := "Как оформить отпуск?"
	require.Equal(t, original, KnowledgeSearchQuery(original))
	long := KnowledgeSearchQuery("отгул" + strings.Repeat("я", 495))
	require.Len(t, []rune(long), 500)
	require.True(t, strings.HasSuffix(long, "отпуск"))
}
