package buddy

import (
	"context"
	"errors"
	"time"
)

type SessionStore interface {
	ProfileByID(ctx context.Context, id string) (Profile, error)
	CreateSession(ctx context.Context, s Session) error
	ProfileBySessionHash(ctx context.Context, hash string) (Profile, error)
}

type Sessions struct {
	store    SessionStore
	tokens   *Tokens
	demoMode bool
}

func NewSessions(store SessionStore, tokens *Tokens, demoMode bool) *Sessions {
	return &Sessions{store: store, tokens: tokens, demoMode: demoMode}
}

func (s *Sessions) CreateDemo(ctx context.Context, profileID string) (string, error) {
	if !s.demoMode {
		return "", ErrNotFound
	}
	if _, err := s.store.ProfileByID(ctx, profileID); err != nil {
		return "", err
	}
	token, expiresAt, err := s.tokens.Issue(profileID, time.Now())
	if err != nil {
		return "", err
	}
	err = s.store.CreateSession(ctx, Session{
		TokenHash: HashToken(token),
		ProfileID: profileID,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return "", err
	}
	return token, nil
}

func (s *Sessions) Authenticate(ctx context.Context, token string) (Profile, error) {
	if _, err := s.tokens.Parse(token); err != nil {
		return Profile{}, err
	}
	p, err := s.store.ProfileBySessionHash(ctx, HashToken(token))
	if errors.Is(err, ErrNotFound) {
		return Profile{}, ErrUnauthenticated
	}
	return p, err
}
