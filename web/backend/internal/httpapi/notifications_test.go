package httpapi

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

type fakeNotifStore struct {
	notifs  []buddy.Notification
	err     error
	profile string
	readIDs []string
}

func (f *fakeNotifStore) ListNotificationsByProfile(context.Context, string) ([]buddy.Notification, error) {
	return f.notifs, f.err
}

func TestNotificationsHTTP(t *testing.T) {
	card := buddy.Notification{
		ID: "n1", Kind: "equator", Title: "Экватор стажировки",
		Body: "Половина позади", ActionTitle: "Пройти опрос",
		ActionURL: "/onboarding?survey=midpoint",
	}

	tests := []struct {
		name       string
		store      *fakeNotifStore
		auth       bool
		wantStatus int
		wantBody   string
	}{
		{"карточка", &fakeNotifStore{notifs: []buddy.Notification{card}}, true, 200, `"read":false`},
		{"пусто — массив, не null", &fakeNotifStore{}, true, 200, `[]`},
		{"без auth", &fakeNotifStore{}, false, 401, `"code":"unauthenticated"`},
		{"сбой БД", &fakeNotifStore{err: errors.New("db down")}, true, 500, `"code":"internal"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			api, token := testAPI(tt.store)
			rec := doRequest(api, token, "GET", "/api/v1/notifications", "", tt.auth)
			require.Equal(t, tt.wantStatus, rec.Code)
			require.Contains(t, rec.Body.String(), tt.wantBody)
		})
	}
}

func (f *fakeNotifStore) MarkNotificationsRead(_ context.Context, profile string, ids []string) error {
	f.profile, f.readIDs = profile, ids
	return f.err
}

func TestMarkNotificationsReadHTTP(t *testing.T) {
	store := &fakeNotifStore{}
	api, token := testAPI(store)
	const path = "/api/v1/notifications/read"
	const body = `{"ids":["5343097a-0d55-48fd-9d5c-652b35e470db"]}`
	require.Equal(t, 401, doRequest(api, token, "POST", path, body, false).Code)
	require.Equal(t, 400, doRequest(api, token, "POST", path, `{"ids":[]}`, true).Code)
	require.Empty(t, store.readIDs)
	require.Equal(t, 204, doRequest(api, token, "POST", path, body, true).Code)
	require.Equal(t, "olga", store.profile)
	require.Equal(t, []string{"5343097a-0d55-48fd-9d5c-652b35e470db"}, store.readIDs)
	store.err = errors.New("db down")
	require.Equal(t, 500, doRequest(api, token, "POST", path, body, true).Code)
}
