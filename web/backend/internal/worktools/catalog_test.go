package worktools

import (
	"context"
	"os"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestCatalogFromPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	defer pool.Close()
	catalog, err := Open(ctx, pool, dsn)
	require.NoError(t, err)
	defer catalog.Close()
	require.Len(t, catalog.pools, 13)
	for id, service := range catalog.services {
		for _, record := range service.Records {
			page, err := catalog.Read(ctx, record.Team, id)
			require.NoError(t, err)
			require.Contains(t, page.Records, record)
		}
	}
	_, err = catalog.Read(ctx, "travel", "redash")
	require.ErrorIs(t, err, buddy.ErrNotFound)
	_, err = catalog.Read(ctx, "delivery", "unknown")
	require.ErrorIs(t, err, buddy.ErrNotFound)
	_, err = catalog.pools["redash"].Exec(ctx, "UPDATE records SET payload=jsonb_set(payload,'{description}',to_jsonb($1::text)) WHERE id='delivery-funnel'", "Проверка живого чтения")
	require.NoError(t, err)
	defer catalog.pools["redash"].Exec(ctx, "UPDATE records SET payload=jsonb_set(payload,'{description}',to_jsonb($1::text)) WHERE id='delivery-funnel'", catalog.services["redash"].Records[0].Description)
	documents, err := catalog.Search(ctx, "delivery", "Где посмотреть воронку?", 3)
	require.NoError(t, err)
	require.Len(t, documents, 1)
	require.Contains(t, documents[0].(map[string]any)["excerpt"], "Проверка живого чтения")
	require.Equal(t, "/work-tools/redash#delivery-funnel", documents[0].(map[string]any)["source"].(map[string]any)["url"])
	documents, err = catalog.Search(ctx, "travel", "Redash", 3)
	require.NoError(t, err)
	require.Empty(t, documents)
}
