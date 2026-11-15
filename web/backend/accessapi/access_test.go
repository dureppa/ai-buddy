package accessapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestStandaloneAccessRegistration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	require.NoError(t, err)
	defer pool.Close()

	mux := http.NewServeMux()
	require.NoError(t, Register(t.Context(), pool, mux, func(r *http.Request) (string, bool) {
		return r.Header.Get("X-Test-Account"), r.Header.Get("X-Test-Delegated") == "yes"
	}))
	call := func(method, path, subject string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("X-Test-Account", subject)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	const path = "/api/v1/portal-access/catalog"
	require.Equal(t, 401, call("GET", path, "").Code)
	catalog := call("GET", path, "olga")
	require.Equal(t, 200, catalog.Code)
	require.Contains(t, catalog.Body.String(), "delivery.orders_mart")
	require.NotContains(t, catalog.Body.String(), "travel/service-api")
	require.Equal(t, 404, call("GET", "/api/v1/confluence/pages", "olga").Code)
}
