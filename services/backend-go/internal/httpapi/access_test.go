package httpapi

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type fakeAccessStore struct {
	reqs        []buddy.AccessRequest
	draft       buddy.AccessRequestDraft
	draftErr    error
	existing    buddy.AccessRequest
	existingErr error
	permission  bool
	created     bool
}

func (f *fakeAccessStore) ListRequestsByProfile(context.Context, string) ([]buddy.AccessRequest, error) {
	return f.reqs, nil
}
func (f *fakeAccessStore) DraftByOwner(context.Context, string, string) (buddy.AccessRequestDraft, error) {
	return f.draft, f.draftErr
}
func (f *fakeAccessStore) HasPermission(context.Context, string, string) (bool, error) {
	return f.permission, nil
}
func (f *fakeAccessStore) RequestByDraft(context.Context, string) (buddy.AccessRequest, error) {
	return f.existing, f.existingErr
}
func (f *fakeAccessStore) InsertRequest(_ context.Context, d buddy.AccessRequestDraft) (buddy.AccessRequest, bool, error) {
	return buddy.AccessRequest{ID: d.ID, Number: "Д-002", ServiceName: "Grafana", Status: "submitted"}, f.created, nil
}

type fakeCorpGateway struct {
	ok bool
}

func (f *fakeCorpGateway) TryExecute(context.Context, string, string, string) (bool, error) {
	return f.ok, nil
}

func accessAPI(store *fakeAccessStore, corp *fakeCorpGateway) (*API, string) {
	tokens := buddy.NewTokens(strings.Repeat("k", 32), time.Hour)
	sessions := buddy.NewSessions(okStore(), tokens, true)
	onb := buddy.NewOnboarding(&fakeOnbStore{})
	access := buddy.NewAccess(store, corp)
	api := NewAPI(sessions, onb, access)
	token, _, _ := tokens.Issue("olga", time.Now())
	return api, token
}

func TestAccessHTTP(t *testing.T) {
	draft := buddy.AccessRequestDraft{ID: "d1", ProfileID: "olga", ServiceID: "grafana", ExpiresAt: time.Now().Add(time.Minute)}
	saved := buddy.AccessRequest{ID: "r1", Number: "Д-001", ServiceName: "Grafana", Status: "submitted"}

	tests := []struct {
		name       string
		store      *fakeAccessStore
		corp       *fakeCorpGateway
		method     string
		path       string
		auth       bool
		wantStatus int
		wantBody   string
	}{
		{
			name: "список заявок", store: &fakeAccessStore{reqs: []buddy.AccessRequest{saved}},
			method: "GET", path: "/api/v1/access-requests", auth: true,
			wantStatus: 200, wantBody: `"number":"Д-001"`,
		},
		{
			name: "список пустой — массив, не null", store: &fakeAccessStore{},
			method: "GET", path: "/api/v1/access-requests", auth: true,
			wantStatus: 200, wantBody: `[]`,
		},
		{
			name: "список без auth", store: &fakeAccessStore{},
			method: "GET", path: "/api/v1/access-requests", auth: false,
			wantStatus: 401, wantBody: `"code":"unauthenticated"`,
		},
		{
			name:   "подтверждение успех",
			store:  &fakeAccessStore{draft: draft, existingErr: buddy.ErrNotFound, permission: true, created: true},
			corp:   &fakeCorpGateway{ok: true},
			method: "POST", path: "/api/v1/access-requests/drafts/d1/confirm", auth: true,
			wantStatus: 200, wantBody: `"status":"submitted"`,
		},
		{
			name: "чужой черновик", store: &fakeAccessStore{draftErr: buddy.ErrNotFound},
			corp:   &fakeCorpGateway{ok: true},
			method: "POST", path: "/api/v1/access-requests/drafts/d1/confirm", auth: true,
			wantStatus: 404, wantBody: `"code":"not_found"`,
		},
		{
			name: "нет права", store: &fakeAccessStore{draft: draft, existingErr: buddy.ErrNotFound},
			corp:   &fakeCorpGateway{ok: true},
			method: "POST", path: "/api/v1/access-requests/drafts/d1/confirm", auth: true,
			wantStatus: 403, wantBody: `"code":"forbidden"`,
		},
		{
			name:   "сбой корпоративного сервиса",
			store:  &fakeAccessStore{draft: draft, existingErr: buddy.ErrNotFound, permission: true},
			corp:   &fakeCorpGateway{ok: false},
			method: "POST", path: "/api/v1/access-requests/drafts/d1/confirm", auth: true,
			wantStatus: 503, wantBody: `"code":"unavailable"`,
		},
		{
			name: "подтверждение без auth", store: &fakeAccessStore{},
			corp:   &fakeCorpGateway{ok: true},
			method: "POST", path: "/api/v1/access-requests/drafts/d1/confirm", auth: false,
			wantStatus: 401, wantBody: `"code":"unauthenticated"`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			corp := tt.corp
			if corp == nil {
				corp = &fakeCorpGateway{ok: true}
			}
			api, token := accessAPI(tt.store, corp)
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.auth {
				req.Header.Set("Authorization", "Bearer "+token)
			}
			rec := httptest.NewRecorder()
			api.Routes().ServeHTTP(rec, req)
			require.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantBody != "" {
				require.Contains(t, rec.Body.String(), tt.wantBody)
			}
		})
	}
}
