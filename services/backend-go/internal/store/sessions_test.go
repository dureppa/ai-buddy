package store

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/config"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := config.TestDatabaseURL() // вместо os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("тестовая БД не настроена (TEST_PGDATABASE или TEST_DATABASE_URL в .env)")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}

func TestSessionsStore(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()

	p, err := st.ProfileByID(ctx, "olga")
	require.NoError(t, err)
	require.Equal(t, "olga", p.ID)

	_, err = st.ProfileByID(ctx, "ghost")
	require.ErrorIs(t, err, buddy.ErrNotFound)

	hash := buddy.HashToken("test-token-" + t.Name())
	require.NoError(t, st.CreateSession(ctx, buddy.Session{
		TokenHash: hash,
		ProfileID: "olga",
		ExpiresAt: time.Now().Add(time.Hour),
	}))
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM sessions WHERE token_hash = $1`, hash)
	})

	p, err = st.ProfileBySessionHash(ctx, hash)
	require.NoError(t, err)
	require.Equal(t, "olga", p.ID)

	_, err = st.ProfileBySessionHash(ctx, buddy.HashToken("missing"))
	require.ErrorIs(t, err, buddy.ErrNotFound)

	expiredHash := buddy.HashToken("expired-" + t.Name())
	_, err = pool.Exec(ctx, `
		INSERT INTO sessions (token_hash, profile_id, created_at, expires_at)
		VALUES ($1, 'olga', now() - interval '2 hours', now() - interval '1 hour')`, expiredHash)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM sessions WHERE token_hash = $1`, expiredHash)
	})
	_, err = st.ProfileBySessionHash(ctx, expiredHash)
	require.ErrorIs(t, err, buddy.ErrNotFound)
}
