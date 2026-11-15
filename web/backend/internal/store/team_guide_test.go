package store

import (
	"context"
	"sync"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/stretchr/testify/require"
)

func TestTeamGuideLifecycle(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	st := New(pool)
	const team = "delivery"
	t.Cleanup(func() { _, _ = pool.Exec(ctx, "DELETE FROM team_guides WHERE team_id = $1", team) })

	for id, expected := range map[string]string{"olga": team, "sasha": "travel", "maria": "help", "timur": "autoteca"} {
		profile, err := st.ProfileByID(ctx, id)
		require.NoError(t, err)
		require.Equal(t, expected, profile.TeamID)
	}
	var calls int
	fail := func(context.Context, buddy.TeamGuideBrief) ([]buddy.TeamGuideCard, error) {
		calls++
		return nil, buddy.ErrUnavailable
	}
	require.NoError(t, st.GenerateNextTeamGuide(ctx, fail))
	require.Zero(t, calls)

	var requests sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		requests.Go(func() { errs <- st.QueueTeamGuide(ctx, team, false) })
	}
	requests.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	require.ErrorIs(t, st.GenerateNextTeamGuide(ctx, fail), buddy.ErrUnavailable)
	require.NoError(t, st.QueueTeamGuide(ctx, team, false))
	require.NoError(t, st.GenerateNextTeamGuide(ctx, fail))
	require.Equal(t, 1, calls)

	require.NoError(t, st.QueueTeamGuide(ctx, team, true))
	cards := []buddy.TeamGuideCard{{Title: "Заказ", Text: "Изучаем оформление доставки."}}
	require.NoError(t, st.GenerateNextTeamGuide(ctx, func(_ context.Context, brief buddy.TeamGuideBrief) ([]buddy.TeamGuideCard, error) {
		require.Equal(t, "Авито Доставка", brief.Product)
		return cards, nil
	}))
	require.NoError(t, st.QueueTeamGuide(ctx, team, true))
	require.NoError(t, st.GenerateNextTeamGuide(ctx, fail))
	guide, err := st.ReadTeamGuide(ctx, team)
	require.NoError(t, err)
	require.Equal(t, buddy.TeamGuide{Status: "ready", Cards: cards}, guide)
	other, err := st.ReadTeamGuide(ctx, "travel")
	require.NoError(t, err)
	require.Equal(t, "missing", other.Status)
}
