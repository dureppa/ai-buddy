package httpapi

import (
	"net/http"
	"strings"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type demoSessionResponse struct {
	AccessToken string `json:"access_token"`
	ProfileID   string `json:"profile_id"`
}

func (a *API) handleDemoSession(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProfileID string `json:"profile_id"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}
	if strings.TrimSpace(req.ProfileID) == "" {
		writeError(w, buddy.ErrInvalidInput)
		return
	}
	token, err := a.sessions.CreateDemo(r.Context(), req.ProfileID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, demoSessionResponse{
		AccessToken: token,
		ProfileID:   req.ProfileID,
	})
}
