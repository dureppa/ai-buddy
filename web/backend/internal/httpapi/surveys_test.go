package httpapi

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type fakeSurveyStore struct {
	stages  []string
	profile string
	stage   string
	answers map[string]string
	err     error
}

func (s *fakeSurveyStore) CompletedSurveys(_ context.Context, profile string) ([]string, error) {
	s.profile = profile
	return s.stages, s.err
}

func (s *fakeSurveyStore) SaveSurvey(_ context.Context, profile, stage string, answers map[string]string) error {
	s.profile, s.stage, s.answers = profile, stage, answers
	return s.err
}

func TestSurveyRoutes(t *testing.T) {
	api, token := testAPI(&fakeNotifStore{})
	store := &fakeSurveyStore{stages: []string{"first"}}
	api.WithSurveys(store)

	const surveys = "/api/v1/onboarding/surveys"
	const answers = `{"answers":{"mentor":"5","hr_bp":"na","buddy":"5","frequency":"4","tasks":"3","access":"2"}}`

	rec := doRequest(api, token, "GET", surveys, "", true)
	require.Equal(t, 200, rec.Code)
	require.JSONEq(t, `["first"]`, rec.Body.String())
	require.NotEmpty(t, store.profile)
	profile := store.profile

	require.Equal(t, 401, doRequest(api, token, "PUT", surveys+"/first", answers, false).Code)
	require.Equal(t, 400, doRequest(api, token, "PUT", surveys+"/unknown", answers, true).Code)
	require.Equal(t, 400, doRequest(api, token, "PUT", surveys+"/first", `{"answers":{}}`, true).Code)
	require.Empty(t, store.answers)
	require.Equal(t, 204, doRequest(api, token, "PUT", surveys+"/first", answers, true).Code)
	require.Equal(t, profile, store.profile)
	require.Equal(t, "first", store.stage)
	require.Equal(t, "na", store.answers["hr_bp"])

	store.err = errors.New("db down")
	require.Equal(t, 500, doRequest(api, token, "PUT", surveys+"/first", answers, true).Code)
	require.Equal(t, 500, doRequest(api, token, "GET", surveys, "", true).Code)
}
