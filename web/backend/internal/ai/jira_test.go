package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestJiraDocumentsUseProfileSessionAndDeepLink(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/demo/sessions", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		if decode(w, r, &body) != nil || body["profile_id"] != "olga" {
			w.WriteHeader(400)
			return
		}
		write(w, 200, map[string]string{"access_token": "demo-token", "profile_id": "olga"})
	})
	mux.HandleFunc("GET /api/v1/me/issues", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer demo-token" {
			w.WriteHeader(401)
			return
		}
		write(w, 200, []map[string]string{{"id": "abc", "key": "DEL-1", "board_id": "delivery-team", "space_id": "delivery", "title": "Воронка", "status": "todo", "due_date": "2026-11-20", "description": "Проверить воронку"}})
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	b := &Bridge{JiraURL: server.URL, PublicJiraURL: "http://localhost:5189", Client: server.Client()}
	docs, err := b.jiraDocuments(context.Background(), "olga", 1)
	require.NoError(t, err)
	require.Len(t, docs, 1)
	require.Contains(t, docs[0].(map[string]any)["source"].(map[string]any)["url"], "issue=abc")
	_, err = b.jiraDocuments(context.Background(), "sasha", 1)
	require.Error(t, err)
}
