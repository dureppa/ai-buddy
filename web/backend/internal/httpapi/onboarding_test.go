package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

type fakeOnbStore struct {
	tasks       []buddy.OnboardingTask
	completeErr error
}

func (f *fakeOnbStore) OnboardingTasks(context.Context, string) ([]buddy.OnboardingTask, error) {
	return f.tasks, nil
}
func (f *fakeOnbStore) TaskExists(_ context.Context, taskID string) (bool, error) {
	for _, t := range f.tasks {
		if t.ID == taskID {
			return true, nil
		}
	}
	return false, nil
}
func (f *fakeOnbStore) CompleteTask(_ context.Context, _, taskID string) error {
	if f.completeErr != nil {
		return f.completeErr
	}
	for i, t := range f.tasks {
		if t.ID == taskID {
			f.tasks[i].Completed = true
			return nil
		}
	}
	return nil
}

func onboardAPI(store *fakeOnbStore) (*API, string) {
	tokens := buddy.NewTokens(strings.Repeat("k", 32), time.Hour)
	api := NewAPI(
		buddy.NewSessions(okStore(), tokens, true),
		buddy.NewOnboarding(store),
		buddy.NewAccess(&fakeAccessStore{}, &fakeCorpGateway{}),
		buddy.NewNotifications(&fakeNotifStore{}),
		buddy.NewChat(buddy.UnavailableAssistant{}),
	)
	token, _, _ := tokens.Issue("olga", time.Now())
	return api, token
}

func TestOnboardingHTTP(t *testing.T) {
	twoTasks := []buddy.OnboardingTask{
		{ID: "papers", Title: "Документы", Guidance: "g", Completed: true},
		{ID: "intro", Title: "Лид", Guidance: "g"},
	}

	tests := []struct {
		name       string
		store      *fakeOnbStore
		method     string
		path       string
		auth       bool
		wantStatus int
		wantBody   string
	}{
		{"get без auth", &fakeOnbStore{tasks: twoTasks}, "GET", "/api/v1/onboarding", false, 401, `"code":"unauthenticated"`},
		{"get список", &fakeOnbStore{tasks: twoTasks}, "GET", "/api/v1/onboarding", true, 200, `"next_task_id":"intro"`},
		{"complete", &fakeOnbStore{tasks: twoTasks}, "PUT", "/api/v1/onboarding/tasks/papers/completion", true, 200, `"next_task_id":"intro"`},
		{"complete без auth", &fakeOnbStore{tasks: twoTasks}, "PUT", "/api/v1/onboarding/tasks/papers/completion", false, 401, `"code":"unauthenticated"`},
		{"complete unknown", &fakeOnbStore{tasks: twoTasks}, "PUT", "/api/v1/onboarding/tasks/ghost/completion", true, 404, `"code":"not_found"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			api, token := onboardAPI(tt.store)
			rec := doRequest(api, token, tt.method, tt.path, "", tt.auth)
			require.Equal(t, tt.wantStatus, rec.Code)
			if tt.wantBody != "" {
				require.Contains(t, rec.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestOnboardingDTOStatuses(t *testing.T) {
	store := &fakeOnbStore{tasks: []buddy.OnboardingTask{
		{ID: "papers", Title: "Документы", Guidance: "g", Completed: true},
		{ID: "intro", Title: "Лид", Guidance: "g"},
	}}
	api, token := onboardAPI(store)
	rec := doRequest(api, token, "GET", "/api/v1/onboarding", "", true)

	body := rec.Body.String()
	require.Contains(t, body, `"status":"completed"`)
	require.Contains(t, body, `"status":"pending"`)
}

func TestOnboardingActionURLOmittedWhenNil(t *testing.T) {
	store := &fakeOnbStore{tasks: []buddy.OnboardingTask{{ID: "intro", Title: "Лид", Guidance: "g"}}}
	api, token := onboardAPI(store)
	rec := doRequest(api, token, "GET", "/api/v1/onboarding", "", true)

	require.NotContains(t, rec.Body.String(), `"action_url":`)
}
