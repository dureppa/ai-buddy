package httpapi

import (
	"github.com/dureppa/ai-buddy/services/backend-go/internal/portal"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/worktools"
	"net/http"
	"strings"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type API struct {
	portal         *portal.Service
	workTools      *worktools.Catalog
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
	if a.workTools != nil {
		mux.HandleFunc("GET /api/v1/work-tools/{service}", a.requireAuth(a.handleWorkTool))
	}
	if a.portal != nil {
		a.portal.Register(mux, func(r *http.Request) (string, error) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				return "", buddy.ErrUnauthenticated
			}
			p, err := a.sessions.Authenticate(r.Context(), strings.TrimPrefix(header, "Bearer "))
			return p.ID, err
		})
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

func (a *API) WithPortal(service *portal.Service) *API { a.portal = service; return a }

func (a *API) WithWorkTools(c *worktools.Catalog) *API {
	a.workTools = c
	return a
}

func (a *API) handleWorkTool(w http.ResponseWriter, r *http.Request) {
	profile, _ := profileFrom(r.Context())
	page, err := a.workTools.Read(r.Context(), profile.TeamID, r.PathValue("service"))
	if err != nil {
		if err != buddy.ErrNotFound {
			err = buddy.ErrUnavailable
		}
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}
