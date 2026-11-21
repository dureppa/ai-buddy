package httpapi

import (
	"net/http"
	"slices"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

type onboardingTaskDTO struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Guidance  string  `json:"guidance"`
	Status    string  `json:"status"`
	ActionURL *string `json:"action_url,omitempty"`
}

type onboardingDTO struct {
	Tasks      []onboardingTaskDTO `json:"tasks"`
	NextTaskID *string             `json:"next_task_id"`
}

func toOnboardingDTO(tasks []buddy.OnboardingTask, next *string) onboardingDTO {
	dto := onboardingDTO{Tasks: make([]onboardingTaskDTO, 0, len(tasks)), NextTaskID: next}
	for _, t := range tasks {
		status := "pending"
		if t.Completed {
			status = "completed"
		}
		dto.Tasks = append(dto.Tasks, onboardingTaskDTO{
			ID: t.ID, Title: t.Title, Guidance: t.Guidance, Status: status, ActionURL: t.ActionURL,
		})
	}
	return dto
}

func (a *API) handleGetOnboarding(w http.ResponseWriter, r *http.Request) {
	p, _ := profileFrom(r.Context())
	tasks, next, err := a.onboarding.Get(r.Context(), p.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toOnboardingDTO(tasks, next))
}

func (a *API) handleCompleteTask(w http.ResponseWriter, r *http.Request) {
	p, _ := profileFrom(r.Context())
	taskID := r.PathValue("task_id")
	tasks, next, err := a.onboarding.Complete(r.Context(), p.ID, taskID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toOnboardingDTO(tasks, next))
}

func (a *API) handleRoleChecklist(w http.ResponseWriter, r *http.Request) {
	actor, _ := profileFrom(r.Context())
	ctx := r.Context()
	targets, err := a.onboarding.ChecklistTargets(ctx, actor)
	if err != nil {
		writeError(w, err)
		return
	}
	profile := r.URL.Query().Get("profile_id")
	if profile == "" {
		if r.Method == http.MethodGet && actor.IsOnboardingStaff() {
			plans := make([]buddy.ChecklistProgress, 0, len(targets))
			for _, id := range targets {
				plan, err := a.onboarding.ChecklistSnapshot(ctx, id)
				if err != nil {
					writeError(w, err)
					return
				}
				plans = append(plans, plan)
			}
			writeJSON(w, http.StatusOK, map[string]any{"plans": plans})
			return
		}
		profile = actor.ID
	}
	if !slices.Contains(targets, profile) {
		writeError(w, buddy.ErrForbidden)
		return
	}
	switch r.Method {
	case http.MethodPost:
		if r.URL.Path == "/api/v1/onboarding/role-checklist/import" {
			if actor.IsOnboardingStaff() {
				writeError(w, buddy.ErrForbidden)
				return
			}
			var input struct {
				Completed []string `json:"completed"`
			}
			if decodeJSON(w, r, &input) != nil || input.Completed == nil || len(input.Completed) > 100 {
				writeError(w, buddy.ErrInvalidInput)
				return
			}
			_, err = a.onboarding.ImportRoleChecklist(ctx, profile, input.Completed)
		} else {
			if !actor.IsOnboardingStaff() {
				writeError(w, buddy.ErrForbidden)
				return
			}
			var input buddy.ChecklistExtraInput
			if decodeJSON(w, r, &input) != nil {
				writeError(w, buddy.ErrInvalidInput)
				return
			}
			err = a.onboarding.AddChecklistExtra(ctx, profile, input)
		}
	case http.MethodDelete:
		if !actor.IsOnboardingStaff() {
			writeError(w, buddy.ErrForbidden)
			return
		}
		err = a.onboarding.DeleteChecklistExtra(ctx, profile, r.PathValue("task_id"))
	case http.MethodPut:
		if actor.IsOnboardingStaff() {
			writeError(w, buddy.ErrForbidden)
			return
		}
		var input struct {
			Done        *bool `json:"done"`
			CurrentOnly bool  `json:"current_only"`
		}
		if decodeJSON(w, r, &input) != nil || input.Done == nil {
			writeError(w, buddy.ErrInvalidInput)
			return
		}
		err = a.onboarding.RecordChecklistMark(ctx, profile, r.PathValue("task_id"), *input.Done, input.CurrentOnly)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	plan, err := a.onboarding.ChecklistSnapshot(ctx, profile)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, plan)
}
