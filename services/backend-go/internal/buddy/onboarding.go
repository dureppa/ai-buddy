package buddy

import "context"

type OnboardingTask struct {
	ID        string
	Title     string
	Guidance  string
	ActionURL *string
	Completed bool
}

type onboardingStore interface {
	OnboardingTasks(ctx context.Context, profileID string) ([]OnboardingTask, error)
	TaskExists(ctx context.Context, taskID string) (bool, error)
	CompleteTask(ctx context.Context, profileID, taskID string) error
}

type Onboarding struct {
	store onboardingStore
}

func NewOnboarding(store onboardingStore) *Onboarding {
	return &Onboarding{store: store}
}

func (s *Onboarding) Get(ctx context.Context, profileID string) ([]OnboardingTask, *string, error) {
	tasks, err := s.store.OnboardingTasks(ctx, profileID)
	if err != nil {
		return nil, nil, err
	}
	return tasks, nextTaskID(tasks), nil
}

func (s *Onboarding) Complete(ctx context.Context, profileID, taskID string) ([]OnboardingTask, *string, error) {
	if taskID == "" {
		return nil, nil, ErrNotFound
	}
	exists, err := s.store.TaskExists(ctx, taskID)
	if err != nil {
		return nil, nil, err
	}
	if !exists {
		return nil, nil, ErrNotFound
	}
	if err := s.store.CompleteTask(ctx, profileID, taskID); err != nil {
		return nil, nil, err
	}
	return s.Get(ctx, profileID)
}

func nextTaskID(tasks []OnboardingTask) *string {
	for _, t := range tasks {
		if !t.Completed {
			id := t.ID
			return &id
		}
	}
	return nil
}
