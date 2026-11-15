package serviceactions

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresConfirmationLifecycle(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := &PGStore{Pool: pool}
	var request string
	if err = pool.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&request); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = pool.Exec(ctx, `DELETE FROM service_action_drafts WHERE fingerprint=$1`, request) }()
	input := Draft{Profile: "olga", RequestID: request, Service: "benefits", Operation: "request_benefit", Fingerprint: request, Payload: []byte(`{"benefit":"sport"}`), Title: "Заявка", Fields: []Field{{"Программа", "Спорт"}}, ServiceURL: "https://example.com/"}
	saved, err := store.Save(ctx, input)
	if err != nil || saved.State != "prepared" || len(saved.Fields) != 1 || time.Until(saved.ExpiresAt) < 9*time.Minute {
		t.Fatalf("%+v %v", saved, err)
	}
	var group sync.WaitGroup
	var claims atomic.Int32
	for range 8 {
		group.Go(func() {
			same, err := store.Save(ctx, input)
			if err != nil || same.ID != saved.ID {
				t.Errorf("dedup %+v %v", same, err)
			}
		})
	}
	group.Wait()
	if _, err = store.Get(ctx, "sasha", saved.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign read", err)
	}
	if _, _, err = store.Claim(ctx, "sasha", saved.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign claim", err)
	}
	if _, err = store.Cancel(ctx, "sasha", saved.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign cancel", err)
	}
	for range 8 {
		group.Go(func() {
			_, claimed, err := store.Claim(ctx, "olga", saved.ID)
			if err != nil {
				t.Error(err)
			}
			if claimed {
				claims.Add(1)
			}
		})
	}
	group.Wait()
	if claims.Load() != 1 {
		t.Fatal("multiple claims", claims.Load())
	}
	done, err := store.Finish(ctx, "olga", saved.ID, "uncertain", "Проверь сервис")
	if err != nil || done.State != "uncertain" || done.StartedAt == nil {
		t.Fatal(done, err)
	}
	_, _ = pool.Exec(ctx, `UPDATE service_action_drafts SET expires_at=now()-interval '1 minute' WHERE id::text=$1`, saved.ID)
	input.RequestID = issueID
	reused, err := store.Save(ctx, input)
	if err != nil || reused.ID != saved.ID || reused.State != "uncertain" {
		t.Fatal("uncertain resubmitted", reused, err)
	}
	_, _ = pool.Exec(ctx, `UPDATE service_action_drafts SET state='prepared' WHERE id::text=$1`, saved.ID)
	if _, claimed, err := store.Claim(ctx, "olga", saved.ID); err != nil || claimed {
		t.Fatal("expired claim", err)
	}
	cancelled, err := store.Cancel(ctx, "olga", saved.ID)
	if err != nil || cancelled.State != "cancelled" {
		t.Fatal(cancelled, err)
	}
	cancelled, err = store.Cancel(ctx, "olga", saved.ID)
	if err != nil || cancelled.State != "cancelled" {
		t.Fatal("cancel replay", err)
	}
	fresh, err := store.Save(ctx, input)
	if err != nil || fresh.ID == saved.ID {
		t.Fatal("new draft", fresh, err)
	}
	_, _, _ = store.Claim(ctx, "olga", fresh.ID)
	done, err = store.Finish(ctx, "olga", fresh.ID, "succeeded", "Сохранено")
	if err != nil || done.Result != "Сохранено" {
		t.Fatal(done, err)
	}
	reused, err = store.Save(ctx, input)
	if err != nil || reused.ID != fresh.ID {
		t.Fatal("success not cached", err)
	}
}
