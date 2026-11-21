package buddy

import (
	"context"
	"slices"
	"strings"
	"unicode/utf8"
)

type ChecklistExtraInput struct {
	Stage   string `json:"stage"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

type ChecklistExtra struct {
	ID string `json:"id"`
	ChecklistExtraInput
	Done bool `json:"-"`
}

type ChecklistProgress struct {
	ProfileID string           `json:"profile_id"`
	Completed []string         `json:"completed"`
	Extras    []ChecklistExtra `json:"extras"`
	Total     int              `json:"total"`
	Percent   int              `json:"percent"`
}

type checklistProgressStore interface {
	ChecklistExtras(context.Context, string) ([]ChecklistExtra, error)
	TeamInternIDs(context.Context, string) ([]string, error)
	AddChecklistExtra(context.Context, string, ChecklistExtraInput) error
	DeleteChecklistExtra(context.Context, string, string) error
	CompleteChecklistExtra(context.Context, string, string, bool) error
}

func (p Profile) IsOnboardingStaff() bool {
	return p.Role == "Руководитель" || p.Role == "Наставник"
}

func (s *Onboarding) ChecklistTargets(ctx context.Context, actor Profile) ([]string, error) {
	if !actor.IsOnboardingStaff() {
		return []string{actor.ID}, nil
	}
	store, ok := s.store.(checklistProgressStore)
	if !ok {
		return nil, ErrUnavailable
	}
	return store.TeamInternIDs(ctx, actor.TeamID)
}

func (s *Onboarding) ChecklistSnapshot(ctx context.Context, profile string) (ChecklistProgress, error) {
	store, ok := s.store.(checklistProgressStore)
	marksStore, hasMarks := s.store.(roleChecklistStore)
	if !ok || !hasMarks {
		return ChecklistProgress{}, ErrUnavailable
	}
	marks, err := s.RoleChecklist(ctx, profile)
	if err != nil {
		return ChecklistProgress{}, err
	}
	surveys, err := marksStore.CompletedSurveys(ctx, profile)
	if err != nil {
		return ChecklistProgress{}, err
	}
	extras, err := store.ChecklistExtras(ctx, profile)
	if err != nil {
		return ChecklistProgress{}, err
	}
	return checklistProgress(profile, marks, surveys, extras), nil
}

func checklistProgress(profile string, marks, surveys []string, extras []ChecklistExtra) ChecklistProgress {
	if extras == nil {
		extras = []ChecklistExtra{}
	}
	result := ChecklistProgress{
		ProfileID: profile, Completed: []string{}, Extras: extras,
		Total: len(roleChecklist.Tasks) + len(extras),
	}
	for _, task := range roleChecklist.Tasks {
		if task.Survey != "" && slices.Contains(surveys, task.Survey) ||
			task.Survey == "" && slices.Contains(marks, task.ID) {
			result.Completed = append(result.Completed, task.ID)
		}
	}
	for _, task := range extras {
		if task.Done {
			result.Completed = append(result.Completed, task.ID)
		}
	}
	if result.Total > 0 {
		result.Percent = (100*len(result.Completed) + result.Total/2) / result.Total
	}
	return result
}

func (s *Onboarding) AddChecklistExtra(ctx context.Context, profile string, input ChecklistExtraInput) error {
	store, ok := s.store.(checklistProgressStore)
	if !ok {
		return ErrUnavailable
	}
	input.Title = strings.TrimSpace(input.Title)
	input.Summary = strings.TrimSpace(input.Summary)
	if !slices.Contains([]string{"week-1", "week-2", "month-1", "month-2", "month-3", "after-3"}, input.Stage) ||
		utf8.RuneCountInString(input.Title) < 2 || utf8.RuneCountInString(input.Title) > 120 ||
		utf8.RuneCountInString(input.Summary) < 2 || utf8.RuneCountInString(input.Summary) > 240 ||
		strings.ContainsRune(input.Title+input.Summary, 0) {
		return ErrInvalidInput
	}
	return store.AddChecklistExtra(ctx, profile, input)
}

func (s *Onboarding) DeleteChecklistExtra(ctx context.Context, profile, id string) error {
	store, ok := s.store.(checklistProgressStore)
	if !ok {
		return ErrUnavailable
	}
	return store.DeleteChecklistExtra(ctx, profile, id)
}

func (s *Onboarding) RecordChecklistMark(ctx context.Context, profile, id string, done, currentOnly bool) error {
	if !strings.HasPrefix(id, "extra-") {
		_, err := s.UpdateRoleChecklist(ctx, profile, id, done, currentOnly)
		return err
	}
	if currentOnly {
		return ErrForbidden
	}
	store, ok := s.store.(checklistProgressStore)
	if !ok {
		return ErrUnavailable
	}
	return store.CompleteChecklistExtra(ctx, profile, id, done)
}
