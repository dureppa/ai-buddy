package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTodayHRKeepsAvailableSource(t *testing.T) {
	const date = "2026-11-16"
	var summary hrSummary
	require.NoError(t, json.Unmarshal([]byte(`{"requests":[
		{"id":"active","start":"2026-11-14","end":"2026-11-16","status":"approved"},
		{"id":"future","start":"2026-11-17","end":"2026-11-18","status":"approved"},
		{"id":"denied","start":"2026-11-15","end":"2026-11-17","status":"rejected"}
	]}`), &summary))
	rows := summary.eventsOn("absences", date)
	require.Len(t, rows, 1)
	require.Equal(t, "Сегодня в отпуске", rows[0].Title)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/me/travel-summary" || bearer(r) == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		today := time.Now().In(time.FixedZone("Moscow", 3*60*60)).Format(time.DateOnly)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"requests":       []any{map[string]string{"id": "pending", "date": today, "status": "pending", "destination": "kazan"}},
			"destinations":   []any{map[string]string{"id": "kazan", "title": "Казань"}},
			"travel_enabled": true,
		})
	}))
	defer server.Close()

	bridge := &Bridge{TripsURL: server.URL, HRSecret: "test-session-secret", Client: server.Client()}
	result := bridge.TodayHR(t.Context(), "maria")
	require.Equal(t, []string{"absences"}, result.Unavailable)
	require.Len(t, result.Events, 1)
	require.Equal(t, "Сегодня · заявка на командировку", result.Events[0].Title)
	require.Equal(t, "Казань · На согласовании", result.Events[0].Detail)
}
