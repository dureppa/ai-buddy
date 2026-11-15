package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dureppa/ai-buddy/tools/shared"
	"github.com/dureppa/ai-buddy/tools/shared/servicetest"
)

func TestPagesRequireSessionAndRespectProduct(t *testing.T) {
	db := servicetest.Postgres(t, `
		CREATE TABLE confluence_pages (
			id text PRIMARY KEY, product_id text, parent_id text, kind text,
			title text, body text, version integer, updated_at timestamptz DEFAULT now()
		);
		INSERT INTO confluence_pages(id, product_id, kind, title, body, version) VALUES
		('delivery', 'delivery', 'team', 'Курьеры', 'Страница команды', 2),
		('travel', 'travel', 'team', 'Маршруты', 'Закрытая страница', 3),
		('common', NULL, 'guide', 'Общие правила', 'Здесь общая информация', 1);
	`)
	mux := routes(db, shared.Sessions{Secret: []byte("test-confluence"), Audience: "confluence", Demo: true})
	const path = "/api/v1/confluence/pages"
	servicetest.Check(t, mux, httptest.NewRequest("GET", path, nil), http.StatusUnauthorized, "unauthenticated")
	token := servicetest.Login(t, mux, "/api/v1/demo/sessions", "olga")
	servicetest.Check(t, mux, servicetest.Authorized("GET", path+"/delivery", token, ""), http.StatusOK, `"version":2`)
	servicetest.Check(t, mux, servicetest.Authorized("GET", path+"/travel", token, ""), http.StatusNotFound, "not_found")
	servicetest.Check(t, mux, servicetest.Authorized("GET", path+"/common", token, ""), http.StatusOK, "Общие правила")
	servicetest.Check(t, mux, servicetest.Authorized("GET", "/api/v1/confluence/search?query=Курьеры&limit=1", token, ""), http.StatusOK, "Курьеры")
}
