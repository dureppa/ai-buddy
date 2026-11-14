package store

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
	"github.com/stretchr/testify/require"
)

func TestAIDataAndChatPersistence(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()
	for _, entry := range []struct {
		tool string
		args map[string]any
	}{{"search_knowledge", map[string]any{"query": "согласия", "limit": float64(3)}}, {"get_team_context", map[string]any{}}, {"get_onboarding_progress", map[string]any{}}, {"get_task_context", map[string]any{"task_id": "consent-news"}}} {
		value, err := st.ReadAI(ctx, "olga", entry.tool, entry.args)
		require.NoError(t, err)
		require.NotEmpty(t, value)
	}
	_, err := st.ReadAI(ctx, "olga", "get_task_context", map[string]any{"task_id": "ghost"})
	require.ErrorIs(t, err, buddy.ErrNotFound)
	_, err = st.ReadAI(ctx, "olga", "search_knowledge", map[string]any{"query": "x", "limit": float64(10)})
	require.ErrorIs(t, err, buddy.ErrInvalidInput)
	var id string
	reply, err := st.ChatTurn(ctx, "olga", buddy.ChatMessage{Text: "Привет"}, func(conversation string, history []buddy.HistoryMessage) (buddy.ChatReply, error) {
		id = conversation
		require.Empty(t, history)
		return buddy.ChatReply{ConversationID: conversation, Kind: "answer", Text: "Ответ", References: []buddy.Reference{}}, nil
	})
	require.NoError(t, err)
	require.Equal(t, id, reply.ConversationID)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM conversations WHERE id=$1`, id) })
	history, err := st.Conversation(ctx, "olga", id)
	require.NoError(t, err)
	require.Len(t, history, 2)
	_, err = st.Conversation(ctx, "sasha", id)
	require.ErrorIs(t, err, buddy.ErrNotFound)
	_, err = st.ChatTurn(ctx, "sasha", buddy.ChatMessage{Text: "Чужой", ConversationID: id}, func(string, []buddy.HistoryMessage) (buddy.ChatReply, error) {
		t.Fatal("foreign conversation reached generator")
		return buddy.ChatReply{}, nil
	})
	require.ErrorIs(t, err, buddy.ErrNotFound)
	_, err = st.ChatTurn(ctx, "olga", buddy.ChatMessage{Text: "Ошибка", ConversationID: id}, func(_ string, h []buddy.HistoryMessage) (buddy.ChatReply, error) {
		require.Len(t, h, 2)
		return buddy.ChatReply{}, buddy.ErrUnavailable
	})
	require.ErrorIs(t, err, buddy.ErrUnavailable)
	history, err = st.Conversation(ctx, "olga", id)
	require.NoError(t, err)
	require.Len(t, history, 3)
}
func TestVersionedReviewTransition(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()
	evaluation := "11111111-1111-4111-8111-111111111111"
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM task_reviews WHERE profile_id='olga'; DELETE FROM onboarding_progress WHERE profile_id='olga' AND task_id='consent-news'`)
	})
	require.NoError(t, st.StartReview(ctx, "olga", evaluation, "Ответ", "e1"))
	require.NoError(t, st.SaveAssessment(ctx, "olga", evaluation, json.RawMessage(`{"criteria":[]}`), true))
	review, err := st.TaskReview(ctx, "olga")
	require.NoError(t, err)
	require.Equal(t, "awaiting_review", review.State)
	require.ErrorIs(t, st.DecideReview(ctx, "olga", evaluation, "mentor", "", "changed", true), buddy.ErrInvalidInput)
	require.NoError(t, st.DecideReview(ctx, "olga", evaluation, "mentor", "Хорошо", "e1", true))
	review, err = st.TaskReview(ctx, "olga")
	require.NoError(t, err)
	require.Equal(t, "completed", review.State)
	require.ErrorIs(t, st.StartReview(ctx, "olga", evaluation, "Новый ответ", "e1"), buddy.ErrInvalidInput)
	require.ErrorIs(t, st.DecideReview(ctx, "olga", evaluation, "mentor", "", "e1", true), buddy.ErrInvalidInput)
}

func TestAIKnowledgeSearchNaturalQuestions(t *testing.T) {
	st := New(testPool(t))
	ctx := context.Background()
	for _, tc := range []struct {
		query   string
		firstID string
	}{
		{"Как оформить отпуск?", "timeoff"},
		{"ОТПУСКОМ", "timeoff"},
		{"  отпуск!!!  ", "timeoff"},
		{"Как проверить микрофон?", "equipment"},
		{"квантоваяфантазия", ""},
		{"как и что", ""},
		{"%%%", ""},
	} {
		t.Run(tc.query, func(t *testing.T) {
			data, err := st.ReadAI(ctx, "olga", "search_knowledge", map[string]any{"query": tc.query, "limit": float64(3)})
			require.NoError(t, err)
			docs := data["documents"].([]any)
			if tc.firstID == "" {
				require.Empty(t, docs)
				return
			}
			require.NotEmpty(t, docs)
			require.LessOrEqual(t, len(docs), 3)
			require.Equal(t, tc.firstID, docs[0].(map[string]any)["source"].(map[string]any)["id"])
		})
	}
}
