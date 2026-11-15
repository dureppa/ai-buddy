package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/tools/shared/servicetest"
)

func TestReferralRejectsDuplicate(t *testing.T) {
	db := servicetest.Postgres(t, schema, seed)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/me/referrals", func(w http.ResponseWriter, r *http.Request) {
		handleCreate(db)(w, r, "sasha")
	})
	mux.HandleFunc("GET /api/v1/me/referral-summary", func(w http.ResponseWriter, r *http.Request) {
		handleSummary(db)(w, r, "sasha")
	})
	payload := `{"vacancy":"design","name":"Тестовый кандидат","email":"person@example.com"}`
	post := func() *http.Request {
		return httptest.NewRequest("POST", "/api/v1/me/referrals", strings.NewReader(payload))
	}
	servicetest.Check(t, mux, post(), http.StatusCreated, "")
	servicetest.Check(t, mux, post(), http.StatusBadRequest, `"code":"invalid_input"`)
	servicetest.Check(t, mux, httptest.NewRequest("GET", "/api/v1/me/referral-summary", nil), http.StatusOK, `"email":"person@example.com"`)
}
