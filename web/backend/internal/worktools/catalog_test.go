package worktools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
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
	_, err = catalog.Read(ctx, "unknown", "redash")
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
	require.Len(t, documents, 1)
	require.NotContains(t, documents[0].(map[string]any)["source"].(map[string]any)["url"], "delivery-funnel")
	require.NotContains(t, documents[0].(map[string]any)["excerpt"], "Проверка живого чтения")
	// Re-running provisioning adds missing records without overwriting existing edits.
	reopened, err := Open(ctx, pool, dsn)
	require.NoError(t, err)
	defer reopened.Close()
	page, err := reopened.Read(ctx, "delivery", "redash")
	require.NoError(t, err)
	require.Equal(t, "Проверка живого чтения", page.Records[0].Description)
}

func TestWorkFixturesMatchStandaloneCatalog(t *testing.T) {
	var services map[string]Page
	require.NoError(t, json.Unmarshal(fixtures, &services))
	require.Len(t, services, 13)
	for name, page := range services {
		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("../../../../tools", name, "demo.json"))
			require.NoError(t, err)
			var standalone Page
			require.NoError(t, json.Unmarshal(raw, &standalone))
			require.Equal(t, page, standalone)
			for _, team := range []string{"delivery", "travel", "autoteca", "help"} {
				found := false
				for _, row := range page.Records {
					if row.Team == team {
						found = true
					}
				}
				require.True(t, found, "missing %s workspace", team)
			}
		})
	}
}
