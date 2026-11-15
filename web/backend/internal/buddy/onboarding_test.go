package buddy

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type fakeOnbStore struct {
	tasks       []OnboardingTask
	completeErr error
}

func (f *fakeOnbStore) OnboardingTasks(context.Context, string) ([]OnboardingTask, error) {
	return f.tasks, nil
}
func (f *fakeOnbStore) TaskExists(_ context.Context, taskID string) (bool, error) {
	for _, t := range f.tasks {
		if t.ID == taskID {
			return true, nil
		}
	}
	return false, nil
}
func (f *fakeOnbStore) CompleteTask(_ context.Context, _, taskID string) error {
	if f.completeErr != nil {
		return f.completeErr
	}
	for i, t := range f.tasks {
		if t.ID == taskID {
			f.tasks[i].Completed = true
			return nil
		}
	}
	return nil
}

func TestOnboardingGetNextTaskID(t *testing.T) {
	ctx := context.Background()
	store := &fakeOnbStore{tasks: []OnboardingTask{
		{ID: "papers", Completed: true},
		{ID: "intro", Completed: false},
		{ID: "equipment", Completed: false},
	}}
	onb := NewOnboarding(store)

	tasks, next, err := onb.Get(ctx, "olga")
	require.NoError(t, err)
	require.Len(t, tasks, 3)
	require.NotNil(t, next)
	require.Equal(t, "intro", *next)
}

func TestOnboardingGetAllCompleted(t *testing.T) {
	ctx := context.Background()
	store := &fakeOnbStore{tasks: []OnboardingTask{
		{ID: "a", Completed: true},
		{ID: "b", Completed: true},
	}}
	_, next, err := NewOnboarding(store).Get(ctx, "x")
	require.NoError(t, err)
	require.Nil(t, next)
}

func TestOnboardingCompleteUnknown(t *testing.T) {
	ctx := context.Background()
	store := &fakeOnbStore{tasks: []OnboardingTask{{ID: "papers"}}}
	_, _, err := NewOnboarding(store).Complete(ctx, "olga", "ghost")
	require.ErrorIs(t, err, ErrNotFound)
}

func TestOnboardingCompleteIdempotent(t *testing.T) {
	ctx := context.Background()
	store := &fakeOnbStore{tasks: []OnboardingTask{
		{ID: "papers", Completed: false},
		{ID: "intro", Completed: false},
	}}
	onb := NewOnboarding(store)

	_, next, err := onb.Complete(ctx, "olga", "papers")
	require.NoError(t, err)
	require.Equal(t, "intro", *next)
	require.True(t, store.tasks[0].Completed)
}

func TestOnboardingCompleteEmptyID(t *testing.T) {
	ctx := context.Background()
	store := &fakeOnbStore{}
	_, _, err := NewOnboarding(store).Complete(ctx, "olga", "")
	require.ErrorIs(t, err, ErrNotFound)
}

func TestOnboardingCompleteStoreError(t *testing.T) {
	ctx := context.Background()
	store := &fakeOnbStore{
		tasks:       []OnboardingTask{{ID: "papers"}},
		completeErr: errors.New("db down"),
	}
	_, _, err := NewOnboarding(store).Complete(ctx, "olga", "papers")
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrNotFound)
}

func TestOnboardingGetEmptyList(t *testing.T) {
	ctx := context.Background()
	store := &fakeOnbStore{tasks: []OnboardingTask{}}
	tasks, next, err := NewOnboarding(store).Get(ctx, "ghost")
	require.NoError(t, err)
	require.Empty(t, tasks)
	require.Nil(t, next)
}

func TestConsentCompletionRequiresMentor(t *testing.T) {
	_, _, err := NewOnboarding(nil).Complete(context.Background(), "olga", "consent-news")
	if err != ErrForbidden {
		t.Fatalf("expected forbidden, got %v", err)
	}
}
