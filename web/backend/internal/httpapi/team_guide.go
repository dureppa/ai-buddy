package httpapi

import (
	"context"
	"net/http"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

type TeamGuideStore interface {
	QueueTeamGuide(context.Context, string, bool) error
	ReadTeamGuide(context.Context, string) (buddy.TeamGuide, error)
}

func (a *API) WithTeamGuide(store TeamGuideStore) *API {
	a.teamGuide = store
	return a
}

func (a *API) handleTeamGuide(w http.ResponseWriter, r *http.Request) {
	profile, _ := profileFrom(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodPost {
		var input struct {
			Retry bool `json:"retry"`
		}
		if r.ContentLength != 0 {
			if err := decodeJSON(w, r, &input); err != nil {
				writeError(w, err)
				return
			}
		}
		if err := a.teamGuide.QueueTeamGuide(r.Context(), profile.TeamID, input.Retry); err != nil {
			writeError(w, err)
			return
		}
	}
	guide, err := a.teamGuide.ReadTeamGuide(r.Context(), profile.TeamID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, guide)
}
