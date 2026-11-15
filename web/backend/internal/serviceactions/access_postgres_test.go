package serviceactions

import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/portal"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestPostgresBIAccessActionConfirmationAndCancellation(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	access := portal.New(pool)
	require.NoError(t, access.EnsureSeed(ctx))
	service, err := New(&PGStore{Pool: pool}, Config{HRSecret: hrKey})
	require.NoError(t, err)
	service.Access = access
	var requestID string
	require.NoError(t, pool.QueryRow(ctx, "SELECT gen_random_uuid()::text").Scan(&requestID))
	action := decodeMap(t, `{"operation":"request_access","template_id":"bi","catalog_version":1,"system":"BI","resource_key":"delivery-bi","permission":"read","duration_days":30,"justification":"Проверить метрики воронки доставки","fields":{"workspace":"Путь заказа"}}`)
	action["justification"] = "Проверить метрики воронки доставки " + requestID
	prepared, err := service.Prepare(ctx, "olga", requestID, map[string]any{"action": action})
	require.NoError(t, err)
	draft := prepared["draft"].(Draft)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM portal_access_requests WHERE operation_key=$1", draft.ID)
		_, _ = pool.Exec(ctx, "DELETE FROM service_action_drafts WHERE request_id=$1::uuid", requestID)
	})
	countRequests := func() int {
		var count int
		require.NoError(t, pool.QueryRow(ctx, "SELECT count(*) FROM portal_access_requests WHERE operation_key=$1", draft.ID).Scan(&count))
		return count
	}
	_, err = service.Get(ctx, "olga", draft.ID)
	require.NoError(t, err)
	require.Zero(t, countRequests(), "prepare and opening confirmation must not submit")
	var wg sync.WaitGroup
	for range 6 {
		wg.Go(func() {
			_, err := service.Confirm(ctx, "olga", draft.ID)
			if err != nil {
				t.Errorf("confirm: %v", err)
			}
		})
	}
	wg.Wait()
	done, err := service.Get(ctx, "olga", draft.ID)
	require.NoError(t, err)
	require.Equal(t, "succeeded", done.State)
	require.Contains(t, done.Result, "ДОС-")
	require.Equal(t, 1, countRequests())
	again, err := service.Confirm(ctx, "olga", draft.ID)
	require.NoError(t, err)
	require.Equal(t, done.Result, again.Result)
	require.Equal(t, 1, countRequests())

	action["permission"] = "write"
	prepared, err = service.Prepare(ctx, "olga", requestID, map[string]any{"action": action})
	require.NoError(t, err)
	cancelled := prepared["draft"].(Draft)
	_, err = service.Cancel(ctx, "olga", cancelled.ID)
	require.NoError(t, err)
	result, err := service.Confirm(ctx, "olga", cancelled.ID)
	require.NoError(t, err)
	require.Equal(t, "cancelled", result.State)
	var count int
	require.NoError(t, pool.QueryRow(ctx, "SELECT count(*) FROM portal_access_requests WHERE operation_key=$1", cancelled.ID).Scan(&count))
	require.Zero(t, count)
}
