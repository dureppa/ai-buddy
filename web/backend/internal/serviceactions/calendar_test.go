package serviceactions

import (
	"context"
	"github.com/dureppa/ai-buddy/web/backend/internal/calendar"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"os"
	"strings"
	"testing"
	"time"
)

type calendarMemory struct {
	writes  int
	owner   string
	events  []calendar.Event
	failure error
}

func (m *calendarMemory) List(_ context.Context, p string, from, to time.Time, _ int) ([]calendar.Event, bool, error) {
	m.owner = p
	out := []calendar.Event{}
	for _, e := range m.events {
		if !e.StartsAt.Before(from) && e.StartsAt.Before(to) {
			out = append(out, e)
		}
	}
	return out, false, m.failure
}
func (m *calendarMemory) Put(_ context.Context, p string, e calendar.Event, _ bool) (calendar.Event, error) {
	m.owner = p
	m.writes++
	m.events = append(m.events, e)
	return e, m.failure
}
func (m *calendarMemory) Delete(context.Context, string, string) error           { return nil }
func (m *calendarMemory) Import(context.Context, string, []calendar.Event) error { return nil }
func TestCalendarActionLifecycle(t *testing.T) {
	for _, mode := range []string{"confirm", "cancel", "expired"} {
		t.Run(mode, func(t *testing.T) {
			ctx := context.Background()
			repo := &calendarMemory{}
			store := &memoryStore{drafts: map[string]Draft{}}
			s, err := New(store, Config{HRSecret: hrKey})
			require.NoError(t, err)
			s.Calendar = &calendar.Service{Store: repo}
			starts := time.Now().Add(48 * time.Hour).Format(time.RFC3339)
			prepared, err := s.Prepare(ctx, "olga", testID, map[string]any{"action": map[string]any{"operation": "create_calendar_event", "title": "Синхронизация", "kind": "Созвон", "starts_at": starts}})
			require.NoError(t, err)
			draft := prepared["draft"].(Draft)
			require.Equal(t, "calendar", draft.Service)
			require.Equal(t, "/events", draft.ServiceURL)
			require.Zero(t, repo.writes)
			_, err = s.Confirm(ctx, "sasha", draft.ID)
			require.ErrorIs(t, err, ErrNotFound)
			require.Zero(t, repo.writes)
			if mode == "cancel" {
				_, err = s.Cancel(ctx, "olga", draft.ID)
				require.NoError(t, err)
			}
			if mode == "expired" {
				d := store.drafts[draft.ID]
				d.ExpiresAt = time.Now().Add(-time.Minute)
				store.drafts[d.ID] = d
			}
			out, err := s.Confirm(ctx, "olga", draft.ID)
			require.NoError(t, err)
			if mode != "confirm" {
				require.Zero(t, repo.writes)
				return
			}
			require.Equal(t, "succeeded", out.State)
			require.Equal(t, 1, repo.writes)
			require.Equal(t, "olga", repo.owner)
			require.Equal(t, draft.ID, repo.events[0].ID)
			_, err = s.Confirm(ctx, "olga", draft.ID)
			require.NoError(t, err)
			require.Equal(t, 1, repo.writes)
			data, err := s.Context(ctx, "olga", map[string]any{"service": "calendar", "start_date": repo.events[0].StartsAt.In(calendar.Moscow).Format(time.DateOnly), "end_date": repo.events[0].StartsAt.In(calendar.Moscow).Format(time.DateOnly)})
			require.NoError(t, err)
			require.Len(t, data["events"], 1)
			require.Equal(t, "Europe/Moscow", data["timezone"])
		})
	}
}
func TestCalendarInvalidAndUnavailable(t *testing.T) {
	s, err := New(&memoryStore{drafts: map[string]Draft{}}, Config{HRSecret: hrKey})
	require.NoError(t, err)
	_, err = s.Context(context.Background(), "olga", map[string]any{"service": "calendar"})
	require.ErrorIs(t, err, ErrUnavailable)
	s.Calendar = &calendar.Service{Store: &calendarMemory{}}
	for _, p := range []map[string]any{
		{"service": "calendar", "period": "bad"}, {"service": "calendar", "start_date": "2026-11-20"}, {"service": "calendar", "board_id": "delivery"}, {"service": "benefits", "period": "week"},
	} {
		_, err = s.Context(context.Background(), "olga", p)
		require.ErrorIs(t, err, ErrInvalid)
	}
	for _, action := range []map[string]any{
		{"operation": "create_calendar_event", "title": "Встреча"},
		{"operation": "create_calendar_event", "title": "Встреча", "starts_at": "2030-01-01T12:00:00"},
		{"operation": "create_calendar_event", "title": "Встреча", "starts_at": "2000-01-01T12:00:00Z"},
		{"operation": "create_calendar_event", "title": "Встреча", "starts_at": "2030-01-01T12:00:00Z", "description": 123},
		{"operation": "create_calendar_event", "title": "Встреча", "starts_at": "2030-01-01T12:00:00Z", "profile": "sasha"},
	} {
		_, err = s.Prepare(context.Background(), "olga", testID, map[string]any{"action": action})
		require.ErrorIs(t, err, ErrInvalid)
	}
}

func TestCalendarContextSizeAndPostgresConfirmation(t *testing.T) {
	ctx := context.Background()
	repo := &calendarMemory{}
	for i := 0; i < 30; i++ {
		repo.events = append(repo.events, calendar.Event{ID: "long", Title: "Событие", Kind: "Встреча", StartsAt: time.Now().Add(time.Hour), Description: strings.Repeat("я", 4000)})
	}
	s, err := New(&memoryStore{drafts: map[string]Draft{}}, Config{HRSecret: hrKey})
	require.NoError(t, err)
	s.Calendar = &calendar.Service{Store: repo}
	data, err := s.Context(ctx, "olga", map[string]any{"service": "calendar", "period": "today"})
	require.NoError(t, err)
	// Use tomorrow if the current test is run shortly before midnight.
	if len(data["events"].([]any)) == 0 {
		data, err = s.Context(ctx, "olga", map[string]any{"service": "calendar", "period": "tomorrow"})
		require.NoError(t, err)
	}
	require.True(t, data["has_more"].(bool))
	require.Less(t, len(data["events"].([]any)), 30)
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required for PostgreSQL part")
	}
	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	s, err = New(&PGStore{Pool: pool}, Config{HRSecret: hrKey})
	require.NoError(t, err)
	s.Calendar = &calendar.Service{Store: &calendar.PGStore{Pool: pool}}
	var request string
	require.NoError(t, pool.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&request))
	prepared, err := s.Prepare(ctx, "olga", request, map[string]any{"action": map[string]any{"operation": "create_calendar_event", "title": "Postgres calendar test " + request, "starts_at": time.Now().Add(24 * time.Hour).Format(time.RFC3339)}})
	require.NoError(t, err)
	draft := prepared["draft"].(Draft)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM calendar_events WHERE profile_id='olga' AND id=$1`, draft.ID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM service_action_drafts WHERE id=$1::uuid`, draft.ID)
	})
	var count int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM calendar_events WHERE profile_id='olga' AND id=$1`, draft.ID).Scan(&count))
	require.Zero(t, count)
	out, err := s.Confirm(ctx, "olga", draft.ID)
	require.NoError(t, err)
	require.Equal(t, "succeeded", out.State)
	out, err = s.Confirm(ctx, "olga", draft.ID)
	require.NoError(t, err)
	require.Equal(t, "succeeded", out.State)
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM calendar_events WHERE profile_id='olga' AND id=$1`, draft.ID).Scan(&count))
	require.Equal(t, 1, count)
}
