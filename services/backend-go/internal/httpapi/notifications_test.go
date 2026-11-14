package httpapi

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type fakeNotifStore struct {
	notifs []buddy.Notification
	err    error
}

func (f *fakeNotifStore) ListNotificationsByProfile(context.Context, string) ([]buddy.Notification, error) {
	return f.notifs, f.err
}

func TestNotificationsHTTP(t *testing.T) {
	card := buddy.Notification{
		ID: "n1", Kind: "equator", Title: "Экватор стажировки",
		Body: "Половина позади", ActionTitle: "Пройти опрос",
		ActionURL: "https://forms.example.com/equator-survey",
	}

	tests := []struct {
		name       string
		store      *fakeNotifStore
		auth       bool
		wantStatus int
		wantBody   string
	}{
		{"карточка", &fakeNotifStore{notifs: []buddy.Notification{card}}, true, 200, `"kind":"equator"`},
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
