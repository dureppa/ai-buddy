package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/tools/shared/servicetest"
)

func TestDraftRequiresChecklistAndLocksChanges(t *testing.T) {
	db := servicetest.Postgres(t, schema, seed)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/me/offboarding/draft", func(w http.ResponseWriter, r *http.Request) {
		handleDraft(db)(w, r, "olga")
	})
	mux.HandleFunc("PUT /api/v1/me/offboarding/checklist/{step}", func(w http.ResponseWriter, r *http.Request) {
		handleToggle(db)(w, r, "olga")
	})
	date := addDays(today(), 30)
	post := func() *http.Request {
		return httptest.NewRequest("POST", "/api/v1/me/offboarding/draft", strings.NewReader(fmt.Sprintf(`{"date":%q}`, date)))
	}
	toggle := func(step string, checked bool) *http.Request {
		return httptest.NewRequest("PUT", "/api/v1/me/offboarding/checklist/"+step, strings.NewReader(fmt.Sprintf(`{"checked":%t}`, checked)))
	}
	servicetest.Check(t, mux, post(), http.StatusBadRequest, "Отметь все шаги")
	for _, step := range []string{"handover", "equipment", "feedback"} {
		servicetest.Check(t, mux, toggle(step, true), http.StatusOK, `"checked":true`)
	}
	servicetest.Check(t, mux, post(), http.StatusCreated, date)
	servicetest.Check(t, mux, toggle("handover", false), http.StatusBadRequest, "Черновик уже сохранён")
}
