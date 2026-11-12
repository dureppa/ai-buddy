package buddy

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type fakeSessionStore struct {
	profileByID   func(context.Context, string) (Profile, error)
	createSession func(context.Context, Session) error
	profileByHash func(context.Context, string) (Profile, error)
}

func (f fakeSessionStore) ProfileByID(ctx context.Context, id string) (Profile, error) {
	return f.profileByID(ctx, id)
}
func (f fakeSessionStore) CreateSession(ctx context.Context, s Session) error {
	return f.createSession(ctx, s)
}
func (f fakeSessionStore) ProfileBySessionHash(ctx context.Context, h string) (Profile, error) {
	return f.profileByHash(ctx, h)
}

func okSessionStore() fakeSessionStore {
	p := Profile{ID: "olga", DisplayName: "Ольга", Role: "Стажёр", TeamID: "product-design"}
	return fakeSessionStore{
		profileByID:   func(context.Context, string) (Profile, error) { return p, nil },
		createSession: func(context.Context, Session) error { return nil },
		profileByHash: func(context.Context, string) (Profile, error) { return p, nil },
	}
}

func TestSessionsCreateDemo(t *testing.T) {
	ctx := context.Background()
	tokens := NewTokens(strings.Repeat("k", 32), time.Hour)

	t.Run("demo выключен", func(t *testing.T) {
		s := NewSessions(okSessionStore(), tokens, false)
		_, err := s.CreateDemo(ctx, "olga")
		require.ErrorIs(t, err, ErrNotFound)
	})

	t.Run("неизвестный профиль", func(t *testing.T) {
		store := okSessionStore()
		store.profileByID = func(context.Context, string) (Profile, error) { return Profile{}, ErrNotFound }
		s := NewSessions(store, tokens, true)
		_, err := s.CreateDemo(ctx, "ghost")
		require.ErrorIs(t, err, ErrNotFound)
	})

	t.Run("успех сохраняет хэш", func(t *testing.T) {
		var created Session
		store := okSessionStore()
		store.createSession = func(_ context.Context, s Session) error { created = s; return nil }
		s := NewSessions(store, tokens, true)
		token, err := s.CreateDemo(ctx, "olga")
		require.NoError(t, err)
		require.NotEmpty(t, token)
		require.Equal(t, HashToken(token), created.TokenHash)
		require.Equal(t, "olga", created.ProfileID)
	})
}

func TestSessionsAuthenticate(t *testing.T) {
	ctx := context.Background()
	tokens := NewTokens(strings.Repeat("k", 32), time.Hour)
	token, _, err := tokens.Issue("olga", time.Now())
	require.NoError(t, err)

	t.Run("валидная сессия", func(t *testing.T) {
		s := NewSessions(okSessionStore(), tokens, true)
		p, err := s.Authenticate(ctx, token)
		require.NoError(t, err)
		require.Equal(t, "olga", p.ID)
	})

	t.Run("сессия не найдена", func(t *testing.T) {
		store := okSessionStore()
		store.profileByHash = func(context.Context, string) (Profile, error) { return Profile{}, ErrNotFound }
		s := NewSessions(store, tokens, true)
		_, err := s.Authenticate(ctx, token)
		require.ErrorIs(t, err, ErrUnauthenticated)
	})

	t.Run("сбой хранилища", func(t *testing.T) {
		store := okSessionStore()
		store.profileByHash = func(context.Context, string) (Profile, error) { return Profile{}, errors.New("db down") }
		s := NewSessions(store, tokens, true)
		_, err := s.Authenticate(ctx, token)
		require.Error(t, err)
		require.NotErrorIs(t, err, ErrUnauthenticated)
	})

	t.Run("мусорный токен", func(t *testing.T) {
		s := NewSessions(okSessionStore(), tokens, true)
		_, err := s.Authenticate(ctx, "garbage")
		require.ErrorIs(t, err, ErrUnauthenticated)
	})
}
