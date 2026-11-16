package calendar

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPostgresCalendarLifecycle(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	defer admin.Close()
	name := fmt.Sprintf("calendar_test_%d", time.Now().UnixNano())
	schema := pgx.Identifier{name}.Sanitize()
	_, err = admin.Exec(ctx, "CREATE SCHEMA "+schema)
	require.NoError(t, err)
	defer func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
	cfg, err := pgxpool.ParseConfig(dsn)
	require.NoError(t, err)
	cfg.ConnConfig.RuntimeParams["search_path"] = name
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	require.NoError(t, err)
	defer pool.Close()
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	require.NoError(t, err)
	paths = append(paths, "../../seeds/demo.sql")
	for _, path := range paths {
		raw, readErr := os.ReadFile(path)
		require.NoError(t, readErr)
		_, err = pool.Exec(ctx, string(raw))
		require.NoError(t, err, path)
	}
	store := &PGStore{Pool: pool}
	service := &Service{Store: store}
	from, to, _ := Window("", "2000-01-01", "2000-01-02", time.Now())
	from = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	to = time.Date(2101, 1, 1, 0, 0, 0, 0, time.UTC)
	rows, more, err := store.List(ctx, "olga", from, to, 500)
	require.NoError(t, err)
	require.Len(t, rows, 3)
	require.False(t, more)
	rows, _, err = store.List(ctx, "olga", from, to, 500)
	require.NoError(t, err)
	require.Len(t, rows, 3)
	e := sample()
	_, err = service.Put(ctx, "olga", e, true)
	require.NoError(t, err)
	_, err = service.Put(ctx, "olga", e, true)
	require.NoError(t, err)
	changed := e
	changed.Title = "Подмена"
	_, err = service.Put(ctx, "olga", changed, true)
	require.ErrorIs(t, err, ErrInvalid)
	require.NoError(t, service.Import(ctx, "olga", []Event{changed})) // server record wins
	rows, _, err = store.List(ctx, "olga", from, to, 500)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, e.Title, rows[0].Title)
	require.NoError(t, service.Import(ctx, "olga", []Event{}))
	rows, _, err = store.List(ctx, "olga", from, to, 500)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	_, err = service.Put(ctx, "olga", changed, false)
	require.NoError(t, err)
	require.ErrorIs(t, service.Delete(ctx, "sasha", e.ID), ErrNotFound)
	require.NoError(t, service.Delete(ctx, "olga", e.ID))
	_, err = service.Put(ctx, "olga", e, true)
	require.ErrorIs(t, err, ErrInvalid)
	require.NoError(t, service.Import(ctx, "sasha", []Event{}))
	rows, _, err = store.List(ctx, "sasha", from, to, 500)
	require.NoError(t, err)
	require.Empty(t, rows)
	past := sample()
	past.ID = "past"
	past.StartsAt = time.Now().Add(-time.Hour)
	_, err = service.Put(ctx, "sasha", past, false)
	require.ErrorIs(t, err, ErrInvalid)
	require.NoError(t, service.Import(ctx, "maria", []Event{past}))
	past.Title = "Исправить описание старого события"
	_, err = service.Put(ctx, "maria", past, false)
	require.NoError(t, err)
	_, more, err = store.List(ctx, "timur", from, to, 1)
	require.NoError(t, err)
	require.True(t, more)
	boundary := []Event{}
	for i, stamp := range []string{"2026-11-15T20:59:59Z", "2026-11-15T21:00:00Z", "2026-11-22T20:59:59Z", "2026-11-22T21:00:00Z"} {
		event := sample()
		event.ID = fmt.Sprintf("boundary-%d", i)
		event.StartsAt, err = time.Parse(time.RFC3339, stamp)
		require.NoError(t, err)
		boundary = append(boundary, event)
	}
	require.NoError(t, service.Import(ctx, "timur", boundary))
	weekStart, weekEnd, err := Window("week", "", "", time.Date(2026, 11, 16, 12, 0, 0, 0, Moscow))
	require.NoError(t, err)
	rows, _, err = store.List(ctx, "timur", weekStart, weekEnd, 30)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	require.Equal(t, "boundary-1", rows[0].ID)
	require.Equal(t, "boundary-2", rows[1].ID)
	newBrowser := sample()
	newBrowser.ID = "second-browser"
	require.NoError(t, service.Import(ctx, "timur", []Event{newBrowser}))
	rows, _, err = store.List(ctx, "timur", from, to, 500)
	require.NoError(t, err)
	require.Len(t, rows, 5)
	_, err = pool.Exec(ctx, `DELETE FROM calendar_events WHERE profile_id='timur'; INSERT INTO calendar_events(profile_id,id,title,kind,starts_at) SELECT 'timur','capacity-'||n,'Событие','Встреча',now()+interval '1 day' FROM generate_series(1,500) n; INSERT INTO calendar_events(profile_id,id,title,kind,starts_at,deleted) VALUES('timur','deleted-capacity','Событие','Встреча',now()+interval '1 day',true)`)
	require.NoError(t, err)
	_, err = service.Put(ctx, "timur", newBrowser, false)
	require.ErrorIs(t, err, ErrInvalid)
	newBrowser.ID = "deleted-capacity"
	_, err = service.Put(ctx, "timur", newBrowser, false)
	require.ErrorIs(t, err, ErrInvalid)
	newBrowser.ID = "capacity-1"
	_, err = service.Put(ctx, "timur", newBrowser, false)
	require.NoError(t, err)
}
