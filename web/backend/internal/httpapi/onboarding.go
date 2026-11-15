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
