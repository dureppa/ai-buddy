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
	require.NotEmpty(t, ns[0].ActionURL)

	ns, err = st.ListNotificationsByProfile(ctx, "olga")
	require.NoError(t, err)
	require.Empty(t, ns)
}
