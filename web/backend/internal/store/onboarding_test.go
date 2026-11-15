package store

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

func TestOnboardingTasksOlga(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()

	tasks, err := st.OnboardingTasks(ctx, "olga")
	require.NoError(t, err)
	require.Equal(t, 15, len(tasks))
	require.Equal(t, "papers", tasks[0].ID)
	require.False(t, tasks[0].Completed)

	tasks2, err := st.OnboardingTasks(ctx, "sasha")
	require.NoError(t, err)
	require.True(t, tasks2[0].Completed)

	_, err = st.OnboardingTasks(ctx, "ghost")
	require.NoError(t, err)
}

func TestTaskExists(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()

	ok, err := st.TaskExists(ctx, "papers")
	require.NoError(t, err)
	require.True(t, ok)

	ok, err = st.TaskExists(ctx, "ghost")
	require.NoError(t, err)
	require.False(t, ok)
}

func TestCompleteTaskIdempotent(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()

	//_Возвращаем тестовую базу к состоянию сидов даже если тест упадёт._
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM onboarding_progress WHERE profile_id = 'olga' AND task_id = 'papers'`)
	})

	err := st.CompleteTask(ctx, "olga", "papers")
	require.NoError(t, err)

	err = st.CompleteTask(ctx, "olga", "papers")
	require.NoError(t, err)

	tasks, err := st.OnboardingTasks(ctx, "olga")
	require.NoError(t, err)
	require.True(t, tasks[0].Completed)

	err = st.CompleteTask(ctx, "olga", "ghost")
	require.ErrorIs(t, err, buddy.ErrNotFound)
}
