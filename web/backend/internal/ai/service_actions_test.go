package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/serviceactions"
	"github.com/stretchr/testify/require"
)

func TestServiceToolDelegation(t *testing.T) {
	downstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "GET", r.Method)
		require.Equal(t, "/api/v1/me/benefit-summary", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"benefit_budget":10000,"benefit_left":10000,"options":[],"requests":[]}`))
	}))
	defer downstream.Close()
	b, _ := newBridge(t, "http://127.0.0.1:8001")
	actions, err := serviceactions.New(nil, serviceactions.Config{HRSecret: strings.Repeat("h", 32), Benefits: serviceactions.Endpoint{URL: downstream.URL, PublicURL: "https://benefits.example/"}})
	require.NoError(t, err)
	b.Actions = actions
	mux := http.NewServeMux()
	b.Register(mux)
	token, err := b.token("olga", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "mcp-delegation")
	require.NoError(t, err)
	resolved := call(mux, "POST", "/internal/v1/ai/context/resolve", b.AdapterToken, `{"delegation_token":"`+token+`"}`)
	require.Equal(t, 200, resolved.Code)
	var data struct {
		Tools []string `json:"allowed_tools"`
		Token string   `json:"api_token"`
	}
	require.NoError(t, json.Unmarshal(resolved.Body.Bytes(), &data))
	require.Contains(t, data.Tools, "get_service_context")
	require.Contains(t, data.Tools, "prepare_service_action")
	require.NotContains(t, data.Tools, "confirm_service_action")
	for _, c := range []struct {
		path, body string
		status     int
	}{{"/internal/v1/ai/service-context", `{"service":"benefits"}`, 200}, {"/internal/v1/ai/service-context", `{"service":"benefits","profile_id":"sasha"}`, 400}, {"/internal/v1/ai/service-actions/prepare", `{"action":{"operation":"confirm"}}`, 400}} {
		r := call(mux, "POST", c.path, data.Token, c.body)
		require.Equal(t, c.status, r.Code, r.Body.String())
	}
	r := httptest.NewRequest("POST", "/internal/v1/ai/service-context", strings.NewReader(`{"service":"benefits"}`))
	r.Header.Set("Authorization", "Bearer "+data.Token)
	r.Header.Set("X-Request-ID", "another-turn")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	require.Equal(t, 403, w.Code)
	require.Equal(t, 401, call(mux, "POST", "/internal/v1/ai/service-context", token, `{"service":"benefits"}`).Code)
}
