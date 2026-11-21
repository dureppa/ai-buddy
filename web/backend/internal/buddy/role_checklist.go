package buddy

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"slices"
)

//go:embed role-checklist.json
var roleChecklistJSON []byte

type roleTask struct {
	ID     string
	Survey string
}

type rolePlan struct {
	Tasks            []roleTask
	InitialCompleted map[string][]string
}

var roleChecklist = func() rolePlan {
	var plan rolePlan
	if err := json.Unmarshal(roleChecklistJSON, &plan); err != nil {
		panic(err)
	}
	return plan
}()

var ErrStaleChecklist = errors.New("текущий пункт изменился")

type roleChecklistStore interface {
	RoleChecklistMarks(ctx context.Context, profile string) ([]string, error)
	CompletedSurveys(ctx context.Context, profile string) ([]string, error)
	UpdateRoleChecklist(ctx context.Context, profile string, update func([]string, []string) ([]string, error)) error
}

func roleMarks(profile string, saved []string) []string {
	if saved != nil {
		return saved
	}
	marks := []string{}
	for _, task := range roleChecklist.Tasks {
		if task.Survey == "" && slices.Contains(roleChecklist.InitialCompleted[profile], task.ID) {
			marks = append(marks, task.ID)
		}
	}
	return marks
}

func updateRoleMarks(profile string, saved, surveys []string, id string, done, currentOnly bool) ([]string, error) {
	index := slices.IndexFunc(roleChecklist.Tasks, func(task roleTask) bool { return task.ID == id })
	if index < 0 {
		return nil, ErrNotFound
	}
	if roleChecklist.Tasks[index].Survey != "" || (currentOnly && !done) {
		return nil, ErrForbidden
	}
	marks := roleMarks(profile, saved)
	if currentOnly {
		next := slices.IndexFunc(roleChecklist.Tasks, func(task roleTask) bool {
			if task.Survey != "" {
				return !slices.Contains(surveys, task.Survey)
			}
			return !slices.Contains(marks, task.ID)
		})
		if index != next {
			return nil, ErrStaleChecklist
		}
	}
	if done && !slices.Contains(marks, id) {
		return append(marks, id), nil
	}
	if !done {
		return slices.DeleteFunc(marks, func(value string) bool { return value == id }), nil
	}
	return marks, nil
}

func (s *Onboarding) RoleChecklist(ctx context.Context, profile string) ([]string, error) {
	store, ok := s.store.(roleChecklistStore)
	if !ok {
		return nil, ErrUnavailable
	}
	marks, err := store.RoleChecklistMarks(ctx, profile)
	return roleMarks(profile, marks), err
}

func (s *Onboarding) UpdateRoleChecklist(ctx context.Context, profile, id string, done, currentOnly bool) ([]string, error) {
	store, ok := s.store.(roleChecklistStore)
	if !ok {
		return nil, ErrUnavailable
	}
	var updated []string
	err := store.UpdateRoleChecklist(ctx, profile, func(marks, surveys []string) ([]string, error) {
		var err error
		updated, err = updateRoleMarks(profile, marks, surveys, id, done, currentOnly)
		return updated, err
	})
	return updated, err
}

func (s *Onboarding) ImportRoleChecklist(ctx context.Context, profile string, legacy []string) ([]string, error) {
	store, ok := s.store.(roleChecklistStore)
	if !ok {
		return nil, ErrUnavailable
	}
	var updated []string
	err := store.UpdateRoleChecklist(ctx, profile, func(saved, _ []string) ([]string, error) {
		updated = saved
		if saved == nil {
			updated = []string{}
			for _, task := range roleChecklist.Tasks {
				if task.Survey == "" && slices.Contains(legacy, task.ID) {
					updated = append(updated, task.ID)
				}
			}
		}
		return updated, nil
	})
	return updated, err
}
