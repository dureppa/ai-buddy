package store

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

const mariaDraftID = "11111111-1111-1111-1111-111111111111"

func TestAccessStoreReads(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()

	reqs, err := st.ListRequestsByProfile(ctx, "maria")
	require.NoError(t, err)
	require.Len(t, reqs, 1)
	require.Equal(t, "Д-001", reqs[0].Number)
	require.Equal(t, "Grafana", reqs[0].ServiceName)
	require.Equal(t, "submitted", reqs[0].Status)

	empty, err := st.ListRequestsByProfile(ctx, "olga")
	require.NoError(t, err)
	require.Empty(t, empty)

	draft, err := st.DraftByOwner(ctx, mariaDraftID, "maria")
	require.NoError(t, err)
	require.Equal(t, "grafana", draft.ServiceID)

	_, err = st.DraftByOwner(ctx, mariaDraftID, "olga")
	require.ErrorIs(t, err, buddy.ErrNotFound)

	_, err = st.DraftByOwner(ctx, "not-a-uuid", "maria")
	require.ErrorIs(t, err, buddy.ErrNotFound)

	ok, err := st.HasPermission(ctx, "olga", "grafana")
	require.NoError(t, err)
	require.True(t, ok)

	ok, err = st.HasPermission(ctx, "sasha", "grafana")
	require.NoError(t, err)
	require.False(t, ok)

	r, err := st.RequestByDraft(ctx, mariaDraftID)
	require.NoError(t, err)
	require.Equal(t, "Д-001", r.Number)

	_, err = st.RequestByDraft(ctx, "22222222-2222-2222-2222-222222222222")
	require.ErrorIs(t, err, buddy.ErrNotFound)
}

func TestInsertRequestIdempotent(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()

	var draftID string
	err := pool.QueryRow(ctx, `
		INSERT INTO access_request_drafts (profile_id, service_id)
		VALUES ('olga', 'jira')
		RETURNING id::text`).Scan(&draftID)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM access_requests WHERE draft_id = $1::uuid`, draftID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM access_request_drafts WHERE id = $1::uuid`, draftID)
	})

	d := buddy.AccessRequestDraft{ID: draftID, ProfileID: "olga", ServiceID: "jira"}

	req, created, err := st.InsertRequest(ctx, d)
	require.NoError(t, err)
	require.True(t, created)
	require.Equal(t, "Jira", req.ServiceName)
	require.NotEmpty(t, req.Number)

	_, created, err = st.InsertRequest(ctx, d)
	require.NoError(t, err)
	require.False(t, created)
}

func TestCorporateIdempotent(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	key := "test-op-" + t.Name()

	corp := NewCorporate(pool, false)
	ok, err := corp.TryExecute(ctx, key, "jira", "olga")
	require.NoError(t, err)
	require.True(t, ok)

	ok, err = corp.TryExecute(ctx, key, "jira", "olga")
	require.NoError(t, err)
	require.True(t, ok)

	var n int
	err = pool.QueryRow(ctx,
		`SELECT count(*) FROM mock_service_operations WHERE operation_key = $1`, key).Scan(&n)
	require.NoError(t, err)
	require.Equal(t, 1, n)

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM mock_service_operations WHERE operation_key = $1`, key)
	})

	fail := NewCorporate(pool, true)
	ok, err = fail.TryExecute(ctx, key+"-fail", "jira", "olga")
	require.NoError(t, err)
	require.False(t, ok)
}
