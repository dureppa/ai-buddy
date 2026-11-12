package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type fakeStore struct {
	profileByID   func(context.Context, string) (buddy.Profile, error)
	createSession func(context.Context, buddy.Session) error
	profileByHash func(context.Context, string) (buddy.Profile, error)
}

func (f fakeStore) ProfileByID(ctx context.Context, id string) (buddy.Profile, error) {
	return f.profileByID(ctx, id)
}
func (f fakeStore) CreateSession(ctx context.Context, s buddy.Session) error {
	return f.createSession(ctx, s)
}
func (f fakeStore) ProfileBySessionHash(ctx context.Context, h string) (buddy.Profile, error) {
	return f.profileByHash(ctx, h)
}

func okStore() fakeStore {
	p := buddy.Profile{ID: "olga", DisplayName: "Ольга", Role: "Стажёр", TeamID: "product-design"}
	return fakeStore{
		profileByID:   func(context.Context, string) (buddy.Profile, error) { return p, nil },
		createSession: func(context.Context, buddy.Session) error { return nil },
		profileByHash: func(context.Context, string) (buddy.Profile, error) { return p, nil },
	}
}

func newTestAPI(demo bool, store fakeStore) (*API, *buddy.Tokens) {
	tokens := buddy.NewTokens(strings.Repeat("k", 32), time.Hour)
	sessions := buddy.NewSessions(store, tokens, demo)
	onboarding := buddy.NewOnboarding(&fakeOnbStore{})
	access := buddy.NewAccess(&fakeAccessStore{}, &fakeCorpGateway{})
	notifications := buddy.NewNotifications(&fakeNotifStore{})
	chat := buddy.NewChat(buddy.UnavailableAssistant{})
	return NewAPI(sessions, onboarding, access, notifications, chat), tokens
}
func TestDemoSession(t *testing.T) {
	unknown := okStore()
	unknown.profileByID = func(context.Context, string) (buddy.Profile, error) { return buddy.Profile{}, buddy.ErrNotFound }

	tests := []struct {
		name       string
		demo       bool
		store      fakeStore
		method     string
		body       string
		wantStatus int
		wantCode   string
	}{
		{"успех", true, okStore(), "POST", `{"profile_id":"olga"}`, 201, ""},
		{"неизвестное поле", true, okStore(), "POST", `{"profile_id":"olga","x":1}`, 400, "invalid_input"},
		{"пустой profile_id", true, okStore(), "POST", `{"profile_id":""}`, 400, "invalid_input"},
		{"пустое тело", true, okStore(), "POST", ``, 400, "invalid_input"},
		{"неизвестный профиль", true, unknown, "POST", `{"profile_id":"ghost"}`, 404, "not_found"},
		{"demo выключен", false, okStore(), "POST", `{"profile_id":"olga"}`, 404, "not_found"},
		{"не тот метод", true, okStore(), "GET", ``, 405, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			api, _ := newTestAPI(tt.demo, tt.store)
			req := httptest.NewRequest(tt.method, "/api/v1/demo/sessions", strings.NewReader(tt.body))
			rec := httptest.NewRecorder()
			api.Routes().ServeHTTP(rec, req)

			require.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantCode != "" {
				require.Contains(t, rec.Body.String(), `"code":"`+tt.wantCode+`"`)
			}
			if tt.wantStatus == 201 {
				require.Contains(t, rec.Body.String(), `"access_token":"`)
				require.Contains(t, rec.Body.String(), `"profile_id":"olga"`)
			}
		})
	}
}

func TestRequireAuth(t *testing.T) {
	api, tokens := newTestAPI(true, okStore())
	valid, _, err := tokens.Issue("olga", time.Now())
	require.NoError(t, err)

	expiredStore := okStore()
	expiredStore.profileByHash = func(context.Context, string) (buddy.Profile, error) {
		return buddy.Profile{}, buddy.ErrNotFound
	}
	brokenStore := okStore()
	brokenStore.profileByHash = func(context.Context, string) (buddy.Profile, error) {
		return buddy.Profile{}, errors.New("db down")
	}

	protected := func(a *API) http.Handler {
		return a.requireAuth(func(w http.ResponseWriter, r *http.Request) {
			p, ok := profileFrom(r.Context())
			require.True(t, ok)
			writeJSON(w, http.StatusOK, map[string]string{"id": p.ID})
		})
	}

	tests := []struct {
		name       string
		api        *API
		header     string
		wantStatus int
	}{
		{"без заголовка", api, "", 401},
		{"не Bearer", api, "Basic abc", 401},
		{"мусорный токен", api, "Bearer garbage", 401},
		{"валидная сессия", api, "Bearer " + valid, 200},
		{"сессия истекла", func() *API { a, _ := newTestAPI(true, expiredStore); return a }(), "Bearer " + valid, 401},
		{"сбой БД", func() *API { a, _ := newTestAPI(true, brokenStore); return a }(), "Bearer " + valid, 500},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/v1/onboarding", nil)
			if tt.header != "" {
				req.Header.Set("Authorization", tt.header)
			}
			rec := httptest.NewRecorder()
			protected(tt.api).ServeHTTP(rec, req)
			require.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantStatus == 200 {
				require.Contains(t, rec.Body.String(), `"id":"olga"`)
			}
		})
	}
}

type fakeNotifStore struct{}

func (fakeNotifStore) ListNotificationsByProfile(context.Context, string) ([]buddy.Notification, error) {
	return nil, nil
}
