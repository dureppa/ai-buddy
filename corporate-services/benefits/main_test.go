package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/tools/shared/servicetest"
)

func TestBenefitDeductsBudgetAndRejectsDuplicate(t *testing.T) {
	db := servicetest.Postgres(t, schema, seed)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/me/benefit-requests", func(w http.ResponseWriter, r *http.Request) {
		handleCreate(db)(w, r, "olga")
	})
	mux.HandleFunc("GET /api/v1/me/benefit-summary", func(w http.ResponseWriter, r *http.Request) {
		handleSummary(db)(w, r, "olga")
	})
	payload := `{"benefit":"learning"}`
	post := func() *http.Request {
		return httptest.NewRequest("POST", "/api/v1/me/benefit-requests", strings.NewReader(payload))
	}
	servicetest.Check(t, mux, post(), http.StatusCreated, "")
	servicetest.Check(t, mux, post(), http.StatusBadRequest, `"code":"invalid_input"`)
	servicetest.Check(t, mux, httptest.NewRequest("GET", "/api/v1/me/benefit-summary", nil), http.StatusOK, `"benefit_left":1500`)
}
