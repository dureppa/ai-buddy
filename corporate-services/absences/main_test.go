package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/tools/shared/servicetest"
)

func TestAbsenceRejectsOverlappingDates(t *testing.T) {
	db := servicetest.Postgres(t, schema, seed)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/me/absence-requests", func(w http.ResponseWriter, r *http.Request) {
		handleCreate(db)(w, r, "olga")
	})
	mux.HandleFunc("GET /api/v1/me/absence-summary", func(w http.ResponseWriter, r *http.Request) {
		handleSummary(db)(w, r, "olga")
	})
	payload := fmt.Sprintf(`{"start":%q,"end":%q}`, addDays(today(), 45), addDays(today(), 46))
	post := func() *http.Request {
		return httptest.NewRequest("POST", "/api/v1/me/absence-requests", strings.NewReader(payload))
	}
	servicetest.Check(t, mux, post(), http.StatusCreated, "")
	servicetest.Check(t, mux, post(), http.StatusBadRequest, `"code":"invalid_input"`)
	servicetest.Check(t, mux, httptest.NewRequest("GET", "/api/v1/me/absence-summary", nil), http.StatusOK, `"days":2`)
}
