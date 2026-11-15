package httpapi

import (
	"context"
	"net/http"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

type surveyStore interface {
	CompletedSurveys(context.Context, string) ([]string, error)
	SaveSurvey(context.Context, string, string, map[string]string) error
}

func (a *API) WithSurveys(store surveyStore) *API {
	a.surveys = store
	return a
}

func (a *API) handleCompletedSurveys(w http.ResponseWriter, r *http.Request) {
	profile, _ := profileFrom(r.Context())
	stages, err := a.surveys.CompletedSurveys(r.Context(), profile.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stages)
}

func (a *API) handleSubmitSurvey(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Answers map[string]string `json:"answers"`
	}
	stage := r.PathValue("stage")
	if decodeJSON(w, r, &payload) != nil || !buddy.ValidSurveyAnswers(stage, payload.Answers) {
		writeError(w, buddy.ErrInvalidInput)
		return
	}
	profile, _ := profileFrom(r.Context())
	if err := a.surveys.SaveSurvey(r.Context(), profile.ID, stage, payload.Answers); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
