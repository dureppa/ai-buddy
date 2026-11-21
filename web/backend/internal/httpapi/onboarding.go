package httpapi

import (
	"net/http"

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
	p, _ := profileFrom(r.Context())
	var marks []string
	var err error
	if r.Method == http.MethodGet {
		marks, err = a.onboarding.RoleChecklist(r.Context(), p.ID)
	} else if r.Method == http.MethodPost {
		var input struct {
			Completed []string `json:"completed"`
		}
		if err := decodeJSON(w, r, &input); err != nil || input.Completed == nil || len(input.Completed) > 100 {
			writeError(w, buddy.ErrInvalidInput)
			return
		}
		marks, err = a.onboarding.ImportRoleChecklist(r.Context(), p.ID, input.Completed)
	} else {
		var input struct {
			Done        *bool `json:"done"`
			CurrentOnly bool  `json:"current_only"`
		}
		if err := decodeJSON(w, r, &input); err != nil || input.Done == nil {
			writeError(w, buddy.ErrInvalidInput)
			return
		}
		marks, err = a.onboarding.UpdateRoleChecklist(r.Context(), p.ID, r.PathValue("task_id"), *input.Done, input.CurrentOnly)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]string{"completed": marks})
}
