package httpapi

import (
	"net/http"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type API struct {
	sessions       *buddy.Sessions
	onboarding     *buddy.Onboarding
	access         *buddy.Access
	notifications  *buddy.Notifications
	chat           *buddy.Chat
	teamGuide      TeamGuideStore
	hrToday        HRTodayReader
	internalRoutes func(*http.ServeMux)
}

func NewAPI(
	sessions *buddy.Sessions,
	onboarding *buddy.Onboarding,
	access *buddy.Access,
	notifications *buddy.Notifications,
	chat *buddy.Chat,
) *API {
	return &API{
		sessions: sessions, onboarding: onboarding, access: access,
		notifications: notifications, chat: chat,
	}
}

func (a *API) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/demo/sessions", a.handleDemoSession)
	mux.HandleFunc("GET /api/v1/onboarding", a.requireAuth(a.handleGetOnboarding))
	mux.HandleFunc("PUT /api/v1/onboarding/tasks/{task_id}/completion", a.requireAuth(a.handleCompleteTask))
	mux.HandleFunc("GET /api/v1/access-requests", a.requireAuth(a.handleListAccessRequests))
	mux.HandleFunc("POST /api/v1/access-requests/drafts/{draft_id}/confirm", a.requireAuth(a.handleConfirmAccessRequest))
	mux.HandleFunc("GET /api/v1/notifications", a.requireAuth(a.handleListNotifications))
	mux.HandleFunc("GET /api/v1/chat/conversations/{conversation_id}", a.requireAuth(a.handleConversation))
	mux.HandleFunc("GET /api/v1/onboarding/consent-review", a.requireAuth(a.handleReview))
	mux.HandleFunc("POST /api/v1/onboarding/consent-review", a.requireAuth(a.handleReview))
	mux.HandleFunc("POST /api/v1/chat/messages", a.requireAuth(a.handleAskBuddy))
	if a.hrToday != nil {
		mux.HandleFunc("GET /api/v1/schedule/hr-today", a.requireAuth(a.handleHRToday))
	}
	if a.teamGuide != nil {
		mux.HandleFunc("POST /api/v1/product-guide/team", a.requireAuth(a.handleTeamGuide))
		mux.HandleFunc("GET /api/v1/product-guide/team", a.requireAuth(a.handleTeamGuide))
	}
	if a.internalRoutes != nil {
		a.internalRoutes(mux)
	}
	return mux
}

func (a *API) WithInternalRoutes(register func(*http.ServeMux)) *API {
	a.internalRoutes = register
	return a
}
