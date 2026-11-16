package calendar

import (
	"context"
	"errors"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWindow(t *testing.T) {
	now := time.Date(2026, 11, 15, 22, 0, 0, 0, time.UTC) // Monday already in Moscow.
	for _, tt := range []struct {
		period, start, end, first, last string
		bad                             bool
	}{
		{"week", "", "", "2026-11-16", "2026-11-23", false}, {"", "", "", "2026-11-16", "2026-11-23", false},
		{"today", "", "", "2026-11-16", "2026-11-17", false}, {"tomorrow", "", "", "2026-11-17", "2026-11-18", false},
		{"next_week", "", "", "2026-11-23", "2026-11-30", false}, {"month", "", "", "2026-11-01", "2026-12-01", false},
		{"", "2028-02-29", "2028-03-01", "2028-02-29", "2028-03-02", false},
		{"", "2026-01-01", "2026-12-31", "2026-01-01", "2027-01-01", false},
		{"", "2026-01-01", "2027-01-02", "", "", true}, {"week", "2026-11-16", "2026-11-17", "", "", true},
		{"", "2026-02-30", "2026-03-01", "", "", true}, {"", "2026-11-16", "", "", "", true},
		{"", "2026-11-17", "2026-11-16", "", "", true}, {"unknown", "", "", "", "", true},
		{"", "1999-12-31", "2000-01-01", "", "", true},
	} {
		t.Run(tt.period+tt.start+tt.end, func(t *testing.T) {
			from, to, err := Window(tt.period, tt.start, tt.end, now)
			if tt.bad {
				require.ErrorIs(t, err, ErrInvalid)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.first, from.Format(time.DateOnly))
			require.Equal(t, tt.last, to.Format(time.DateOnly))
			_, offset := from.Zone()
			require.Equal(t, 3*3600, offset)
		})
	}
	from, to, err := Window("week", "", "", time.Date(2027, 1, 3, 12, 0, 0, 0, Moscow))
	require.NoError(t, err)
	require.Equal(t, "2026-12-28", from.Format(time.DateOnly))
	require.Equal(t, "2027-01-04", to.Format(time.DateOnly))
}
func sample() Event {
	return Event{ID: "test-event", Title: "Встреча", Kind: "Встреча", StartsAt: time.Now().Add(time.Hour), Description: "Поговорить"}
}
func TestValidationAndDemo(t *testing.T) {
	now := time.Now()
	require.NoError(t, Validate(sample(), true, now))
	for _, change := range []func(*Event){func(e *Event) { e.ID = "../other" }, func(e *Event) { e.Title = " " }, func(e *Event) { e.Title = strings.Repeat("я", 121) }, func(e *Event) { e.Kind = "unknown" }, func(e *Event) { e.StartsAt = time.Time{} }, func(e *Event) { e.StartsAt = now.Add(-time.Hour) }, func(e *Event) { e.Description = strings.Repeat("a", 4001) }, func(e *Event) { e.Description = "bad\x00" }} {
		e := sample()
		change(&e)
		require.ErrorIs(t, Validate(e, true, now), ErrInvalid)
	}
	require.Equal(t, "blue", Tone("Созвон"))
	require.Equal(t, "lilac", Tone("Напоминание"))
	require.Empty(t, Tone("bad"))
	for _, profile := range []string{"olga", "sasha", "timur", "maria"} {
		events := demoEvents(profile, time.Date(2026, 11, 16, 23, 0, 0, 0, Moscow))
		require.NotEmpty(t, events)
		for _, e := range events {
			require.NoError(t, Validate(e, true, time.Date(2026, 11, 16, 23, 0, 0, 0, Moscow)))
		}
	}
}

type memory struct {
	events  []Event
	owner   string
	failure error
}

func (m *memory) List(_ context.Context, p string, _, _ time.Time, _ int) ([]Event, bool, error) {
	m.owner = p
	return m.events, false, m.failure
}
func (m *memory) Put(_ context.Context, p string, e Event, _ bool) (Event, error) {
	m.owner = p
	m.events = append(m.events, e)
	return e, m.failure
}
func (m *memory) Delete(_ context.Context, p, id string) error {
	m.owner = p
	if m.failure != nil {
		return m.failure
	}
	m.events = []Event{}
	return nil
}
func (m *memory) Import(_ context.Context, p string, rows []Event) error {
	m.owner = p
	m.events = rows
	return m.failure
}
func TestServiceAndHTTP(t *testing.T) {
	repo := &memory{events: []Event{sample()}}
	service := &Service{Store: repo}
	mux := http.NewServeMux()
	service.Register(mux, func(r *http.Request) (string, error) {
		if r.Header.Get("Authorization") != "test-session" {
			return "", errors.New("auth")
		}
		return "olga", nil
	})
	call := func(method, path, body string, auth bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if auth {
			r.Header.Set("Authorization", "test-session")
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	require.Equal(t, 401, call("GET", "/api/v1/schedule/events", "", false).Code)
	require.Equal(t, 200, call("GET", "/api/v1/schedule/events", "", true).Code)
	require.Equal(t, "olga", repo.owner)
	require.Equal(t, 400, call("PUT", "/api/v1/schedule/events/e", `{"id":"wrong"}`, true).Code)
	require.Equal(t, 400, call("POST", "/api/v1/schedule/import", `{"events":[],"profile":"sasha"}`, true).Code)
	require.Equal(t, 400, call("POST", "/api/v1/schedule/import", `{"events":[]} {}`, true).Code)
	require.Equal(t, 200, call("POST", "/api/v1/schedule/import", `{"events":[]}`, true).Code)
	require.Equal(t, 200, call("DELETE", "/api/v1/schedule/events/test-event", "", true).Code)
	repo.failure = ErrNotFound
	require.Equal(t, 404, call("DELETE", "/api/v1/schedule/events/test-event", "", true).Code)
	repo.failure = errors.New("db")
	require.Equal(t, 503, call("GET", "/api/v1/schedule/events", "", true).Code)
	e := sample()
	saved, err := service.Put(context.Background(), "olga", e, true)
	require.Error(t, err)
	require.Equal(t, e.ID, saved.ID)
	repo.failure = nil
	_, err = service.Put(context.Background(), "olga", e, true)
	require.NoError(t, err)
	e.Kind = "bad"
	_, err = service.Put(context.Background(), "olga", e, true)
	require.ErrorIs(t, err, ErrInvalid)
	require.ErrorIs(t, service.Import(context.Background(), "olga", nil), ErrInvalid)
	require.ErrorIs(t, service.Import(context.Background(), "olga", []Event{sample(), sample()}), ErrInvalid)
	require.ErrorIs(t, service.Delete(context.Background(), "olga", "../other"), ErrInvalid)
}
