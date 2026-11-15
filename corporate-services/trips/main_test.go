package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/tools/shared/servicetest"
)

func TestTripAllowsOnePendingRequest(t *testing.T) {
	db := servicetest.Postgres(t, schema, seed)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/me/trip-requests", func(w http.ResponseWriter, r *http.Request) {
		handleCreate(db)(w, r, "sasha")
	})
	mux.HandleFunc("GET /api/v1/me/travel-summary", func(w http.ResponseWriter, r *http.Request) {
		handleSummary(db)(w, r, "sasha")
	})
	payload := fmt.Sprintf(`{"destination":"kazan","date":%q,"budget":20000}`, addDays(today(), 30))
	post := func() *http.Request {
		return httptest.NewRequest("POST", "/api/v1/me/trip-requests", strings.NewReader(payload))
	}
	servicetest.Check(t, mux, post(), http.StatusCreated, "")
	servicetest.Check(t, mux, post(), http.StatusBadRequest, `"code":"invalid_input"`)
	servicetest.Check(t, mux, httptest.NewRequest("GET", "/api/v1/me/travel-summary", nil), http.StatusOK, `"destination":"kazan"`)
}
