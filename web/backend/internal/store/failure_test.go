package store

import (
	"context"
	"testing"
	"time"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestRepositoriesPropagateDatabaseUnavailability(t *testing.T) {
	pool, err := pgxpool.New(t.Context(), "postgres://user@localhost/test")
	require.NoError(t, err)
	pool.Close()
	s := New(pool)
	ctx := t.Context()
	const profile = "olga"
	const id = "9b532237-a5d9-493a-9af5-4ac0bb6f1595"

	_, err = s.ListRequestsByProfile(ctx, profile)
	require.ErrorContains(t, err, "list requests")
	_, err = s.DraftByOwner(ctx, id, profile)
	require.ErrorContains(t, err, "draft by owner")
	_, err = s.HasPermission(ctx, profile, "jira")
	require.ErrorContains(t, err, "has permission")
	_, err = s.RequestByDraft(ctx, id)
	require.ErrorContains(t, err, "request by draft")
	_, _, err = s.InsertRequest(ctx, buddy.AccessRequestDraft{ID: id, ProfileID: profile, ServiceID: "jira"})
	require.ErrorContains(t, err, "insert request")
	_, err = s.OnboardingTasks(ctx, profile)
	require.Error(t, err)
	_, err = s.TaskExists(ctx, "documents")
	require.Error(t, err)
	require.Error(t, s.CompleteTask(ctx, profile, "documents"))
	_, err = s.ProfileByID(ctx, profile)
	require.Error(t, err)
	_, err = s.ProfileBySessionHash(ctx, "hash")
	require.Error(t, err)
	require.Error(t, s.CreateSession(ctx, buddy.Session{ProfileID: profile, ExpiresAt: time.Now().Add(time.Minute)}))
	_, err = s.ChatTurn(ctx, profile, buddy.ChatMessage{Text: "Вопрос"}, func(string, []buddy.HistoryMessage) (buddy.ChatReply, error) {
		t.Fatal("generation must not start after storage failure")
		return buddy.ChatReply{}, nil
	})
	require.Error(t, err)
	_, err = s.Conversation(ctx, profile, id)
	require.ErrorIs(t, err, buddy.ErrInvalidInput)
	require.Error(t, s.StartReview(ctx, profile, id, "Ответ", "v1"))
	require.Error(t, s.SaveAssessment(ctx, profile, id, []byte("{}"), true))
	require.Error(t, s.DecideReview(ctx, profile, id, "mentor", "", "v1", true))
	_, err = s.ListNotificationsByProfile(ctx, profile)
	require.ErrorContains(t, err, "list notifications")
	_, err = s.CompletedSurveys(ctx, profile)
	require.Error(t, err)
	_, err = NewCorporate(pool, false).TryExecute(ctx, id, "jira", profile)
	require.Error(t, err)

	for _, tt := range []struct {
		tool string
		args map[string]any
	}{
		{"search_knowledge", map[string]any{"query": "материалы", "limit": float64(2)}},
		{"get_team_context", nil}, {"get_onboarding_progress", nil},
		{"get_task_context", map[string]any{"task_id": "documents"}},
	} {
		_, err = s.ReadAI(ctx, profile, tt.tool, tt.args)
		require.Error(t, err, tt.tool)
		require.NotErrorIs(t, err, buddy.ErrInvalidInput)
	}
}

func TestReadAIToolRejectsUnexpectedArguments(t *testing.T) {
	s := &Store{}
	for _, tool := range []string{"get_team_context", "get_onboarding_progress", "get_task_context"} {
		_, err := s.ReadAI(t.Context(), "olga", tool, map[string]any{"unexpected": true})
		require.ErrorIs(t, err, buddy.ErrInvalidInput)
	}
	_, err := s.ReadAI(context.Background(), "olga", "unknown", nil)
	require.ErrorContains(t, err, "unsupported AI read")
}
