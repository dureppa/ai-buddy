package worktools

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestExternalSearchUsesScopedToolAPI(t *testing.T) {
	const secret = "work-tool-test-delegation-secret"
	catalog, err := NewExternal("https://tools.example.com", secret)
	require.NoError(t, err)
	catalog.external.Transport = roundTrip(func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "http://tool-grafana:8200/api/v1/work-tools/grafana", request.URL.String())
		raw := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
		claims := &jwt.RegisteredClaims{}
		_, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) {
			return []byte(secret), nil
		}, jwt.WithAudience("grafana"), jwt.WithExpirationRequired())
		require.NoError(t, err)
		require.Equal(t, "sasha", claims.Subject)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body: io.NopCloser(strings.NewReader(fmt.Sprintf(
				`{"name":"Grafana","records":[{"id":"record","title":"Ошибки","description":"%s"}]}`, "Запись внешней БД",
			))),
		}, nil
	})
	results, err := catalog.Search(context.Background(), "travel", "Grafana", 2)
	require.NoError(t, err)
	require.Len(t, results, 1)
	require.Contains(t, results[0].(map[string]any)["excerpt"], "Запись внешней БД")
	require.Equal(t, "https://tools.example.com/work-tools/grafana#record", results[0].(map[string]any)["source"].(map[string]any)["url"])
}
