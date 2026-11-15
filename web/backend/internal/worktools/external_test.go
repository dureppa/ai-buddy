package worktools

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
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
				`{"name":"Grafana","area":"Мониторинг","records":[{"team":"travel","id":"record","title":"Ошибки","description":"%s","fields":{}}]}`, "Запись внешней БД",
			))),
		}, nil
	})
	results, err := catalog.Search(context.Background(), "travel", "Grafana", 2)
	require.NoError(t, err)
	require.Len(t, results, 1)
	require.Contains(t, results[0].(map[string]any)["excerpt"], "Запись внешней БД")
	require.Equal(t, "https://tools.example.com/work-tools/grafana#record", results[0].(map[string]any)["source"].(map[string]any)["url"])
}

func TestExternalCatalogRejectsUnavailableOrUnscopedRecords(t *testing.T) {
	const secret = "work-tool-test-delegation-secret"
	_, err := NewExternal("https://tools.example.com/not-an-origin", secret)
	require.ErrorContains(t, err, "WORK_TOOLS_PUBLIC_URL")
	_, err = NewExternal("https://tools.example.com", "short")
	require.ErrorContains(t, err, "WORK_TOOL_DELEGATION_SECRET")

	catalog, err := NewExternal("https://tools.example.com", secret)
	require.NoError(t, err)
	for _, tt := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"removed page", 404, "", buddy.ErrNotFound},
		{"unavailable service", 503, "", buddy.ErrUnavailable},
		{"trailing JSON", 200, `{"records":[]}{}`, buddy.ErrUnavailable},
		{"missing records", 200, `{}`, buddy.ErrUnavailable},
		{"oversized response", 200, strings.Repeat(" ", (2<<20)+1), buddy.ErrUnavailable},
		{"other team", 200, `{"records":[{"team":"delivery","id":"record","title":"Ошибки"}]}`, buddy.ErrUnavailable},
		{"missing title", 200, `{"records":[{"team":"travel","id":"record","title":" "}]}`, buddy.ErrUnavailable},
	} {
		t.Run(tt.name, func(t *testing.T) {
			catalog.external.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tt.status, Body: io.NopCloser(strings.NewReader(tt.body))}, nil
			})
			out, err := catalog.Read(t.Context(), "travel", "grafana")
			require.ErrorIs(t, err, tt.want)
			require.Empty(t, out.Records)
		})
	}
	catalog.external.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
		return nil, io.ErrUnexpectedEOF
	})
	_, err = catalog.Read(t.Context(), "travel", "grafana")
	require.ErrorIs(t, err, buddy.ErrUnavailable)
}
