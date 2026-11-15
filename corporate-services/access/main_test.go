package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/dureppa/ai-buddy/tools/shared"
	"github.com/dureppa/ai-buddy/tools/shared/servicetest"
)

func TestStandalonePortalScopesCatalogAndRequests(t *testing.T) {
	schema, err := os.ReadFile("schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db := servicetest.Postgres(t, string(schema))
	handler, err := routes(context.Background(), db, shared.Sessions{
		Secret: []byte("test-access"), Audience: "access", Demo: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	const catalog = "/api/v1/portal-access/catalog"
	servicetest.Check(t, handler, httptest.NewRequest("GET", catalog, nil), http.StatusUnauthorized, "unauthenticated")
	token := servicetest.Login(t, handler, "/api/v1/demo/sessions", "olga")
	servicetest.Check(t, handler, servicetest.Authorized("GET", catalog, token, ""), http.StatusOK, "delivery.orders_mart")
	requests := "/api/v1/portal-access/requests"
	body := `{"template_id":"dwh","catalog_version":1,"system":"DWH","resource_key":"delivery.orders_mart","justification":"Сравнить показатели по доставке","permission":"read","duration_days":30,"fields":{"usage":"Исследование"}}`
	for range 2 {
		request := servicetest.Authorized("POST", requests, token, body)
		request.Header.Set("Idempotency-Key", "sample-case")
		servicetest.Check(t, handler, request, http.StatusOK, "ДОС-000001")
	}
	foreign := servicetest.Login(t, handler, "/api/v1/demo/sessions", "sasha")
	servicetest.Check(t, handler, servicetest.Authorized("GET", requests, foreign, ""), http.StatusOK, "[]")
}
