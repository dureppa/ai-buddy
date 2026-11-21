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

func TestConcurrentRoleChecklistCompletesOnlyDisplayedTask(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	service := buddy.NewOnboarding(st)
	ctx := context.Background()
	const profile, displayed = "olga", "dev-principles"
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM role_checklist_progress WHERE profile_id = $1", profile)
	})
	results := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := service.UpdateRoleChecklist(ctx, profile, displayed, true, true)
			results <- err
		}()
	}
	var successes, rejected int
	for range 2 {
		err := <-results
		switch err {
		case nil:
			successes++
		case buddy.ErrStaleChecklist:
			rejected++
		default:
			t.Fatalf("unexpected completion result: %v", err)
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, rejected)
	marks, err := service.RoleChecklist(ctx, profile)
	require.NoError(t, err)
	require.Contains(t, marks, displayed)
	require.NotContains(t, marks, "avito-numbers")
}
