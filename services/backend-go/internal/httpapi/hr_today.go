package httpapi

import (
	"context"
	"net/http"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type HRTodayReader func(context.Context, string) buddy.HRToday

func (a *API) WithHRToday(reader HRTodayReader) *API {
	a.hrToday = reader
	return a
}

func (a *API) handleHRToday(w http.ResponseWriter, r *http.Request) {
	profile, _ := profileFrom(r.Context())
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, a.hrToday(r.Context(), profile.ID))
}
