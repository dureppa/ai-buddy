package store

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNotificationsStore(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()

	ns, err := st.ListNotificationsByProfile(ctx, "sasha")
	require.NoError(t, err)
	require.Len(t, ns, 1)
	require.Equal(t, "equator", ns[0].Kind)
	require.NotEmpty(t, ns[0].Title)
	require.NotEmpty(t, ns[0].Body)
	require.NotEmpty(t, ns[0].ActionTitle)
	require.Equal(t, "/onboarding?survey=midpoint", ns[0].ActionURL)
	id := ns[0].ID
	_, err = pool.Exec(ctx, "UPDATE notifications SET read_at = NULL WHERE id = $1", id)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := pool.Exec(ctx, "UPDATE notifications SET read_at = NULL WHERE id = $1", id)
		require.NoError(t, err)
	})

	require.NoError(t, st.MarkNotificationsRead(ctx, "olga", []string{id}))
	ns, err = st.ListNotificationsByProfile(ctx, "sasha")
	require.NoError(t, err)
	require.False(t, ns[0].Read)
	require.NoError(t, st.MarkNotificationsRead(ctx, "sasha", []string{id}))
	ns, err = st.ListNotificationsByProfile(ctx, "sasha")
	require.NoError(t, err)
	require.True(t, ns[0].Read)

	ns, err = st.ListNotificationsByProfile(ctx, "olga")
	require.NoError(t, err)
	require.Len(t, ns, 2)
}
