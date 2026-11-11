package httpapi

import (
	"net/http"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type API struct {
	sessions   *buddy.Sessions
	onboarding *buddy.Onboarding
	access     *buddy.Access
}

func NewAPI(sessions *buddy.Sessions, onboarding *buddy.Onboarding, access *buddy.Access) *API {
	return &API{sessions: sessions, onboarding: onboarding, access: access}
}

func (a *API) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/demo/sessions", a.handleDemoSession)
	mux.HandleFunc("GET /api/v1/onboarding", a.requireAuth(a.handleGetOnboarding))
	mux.HandleFunc("PUT /api/v1/onboarding/tasks/{task_id}/completion", a.requireAuth(a.handleCompleteTask))
	mux.HandleFunc("GET /api/v1/access-requests", a.requireAuth(a.handleListAccessRequests))
	mux.HandleFunc("POST /api/v1/access-requests/drafts/{draft_id}/confirm", a.requireAuth(a.handleConfirmAccessRequest))
	return mux
}
