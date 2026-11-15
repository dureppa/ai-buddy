package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/dureppa/ai-buddy/web/backend/internal/portal"
	"github.com/dureppa/ai-buddy/web/backend/internal/serviceactions"
	"github.com/dureppa/ai-buddy/web/backend/internal/worktools"
	"github.com/stretchr/testify/require"
)

type guideStore struct {
	queueErr, readErr error
	queued, retry     bool
}

func (s *guideStore) QueueTeamGuide(_ context.Context, team string, retry bool) error {
	if team != "product-design" {
		return buddy.ErrNotFound
	}
	s.queued, s.retry = true, retry
	return s.queueErr
}

func (s *guideStore) ReadTeamGuide(_ context.Context, team string) (buddy.TeamGuide, error) {
	if team != "product-design" {
		return buddy.TeamGuide{}, buddy.ErrNotFound
	}
	return buddy.TeamGuide{Status: "pending"}, s.readErr
}

func TestTeamGuideAndHRRoutes(t *testing.T) {
	api, token := testAPI()
	store := &guideStore{}
	api.WithTeamGuide(store).WithHRToday(func(_ context.Context, profile string) buddy.HRToday {
		require.Equal(t, "olga", profile)
		return buddy.HRToday{Unavailable: []string{"trips"}}
	})
	const guide = "/api/v1/product-guide/team"
	const hr = "/api/v1/schedule/hr-today"

	require.Equal(t, 401, doRequest(api, token, "GET", guide, "", false).Code)
	got := doRequest(api, token, "GET", guide, "", true)
	require.Equal(t, "no-store", got.Header().Get("Cache-Control"))
	require.JSONEq(t, `{"status":"pending"}`, got.Body.String())
	require.False(t, store.queued)
	require.Equal(t, 400, doRequest(api, token, "POST", guide, `{"wrong":true}`, true).Code)
	require.Equal(t, 200, doRequest(api, token, "POST", guide, "", true).Code)
	require.True(t, store.queued)
	require.False(t, store.retry)
	require.Equal(t, 200, doRequest(api, token, "POST", guide, `{"retry":true}`, true).Code)
	require.True(t, store.retry)
	store.queueErr = buddy.ErrUnavailable
	require.Equal(t, 503, doRequest(api, token, "POST", guide, "", true).Code)
	store.readErr = errors.New("storage offline")
	require.Equal(t, 500, doRequest(api, token, "GET", guide, "", true).Code)

	require.Equal(t, 401, doRequest(api, token, "GET", hr, "", false).Code)
	got = doRequest(api, token, "GET", hr, "", true)
	require.Equal(t, 200, got.Code)
	require.Equal(t, "no-store", got.Header().Get("Cache-Control"))
	require.Contains(t, got.Body.String(), `"unavailable":["trips"]`)
}

func TestMountedIntegrationsRequireBuddySession(t *testing.T) {
	api, token := testAPI()
	catalog, err := worktools.NewExternal("http://localhost:5192", strings.Repeat("w", 32))
	require.NoError(t, err)
	actions, err := serviceactions.New(nil, serviceactions.Config{HRSecret: strings.Repeat("h", 32)})
	require.NoError(t, err)
	api.WithWorkTools(catalog).WithServiceActions(actions).WithPortal(portal.New(nil)).
		WithInternalRoutes(func(mux *http.ServeMux) {
			mux.HandleFunc("GET /internal/test", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})
		})
	for _, path := range []string{
		"/api/v1/work-tools/redash", "/api/v1/portal-access/catalog", "/api/v1/service-actions/unknown",
	} {
		require.Equal(t, 401, doRequest(api, token, "GET", path, "", false).Code, path)
	}
	require.Equal(t, 404, doRequest(api, token, "GET", "/api/v1/work-tools/unknown", "", true).Code)
	require.Equal(t, 204, doRequest(api, token, "GET", "/internal/test", "", false).Code)
}
