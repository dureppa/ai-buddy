package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

func (s *Store) ProfileByID(ctx context.Context, id string) (buddy.Profile, error) {
	var p buddy.Profile
	err := s.q.QueryRow(ctx,
		`SELECT id, display_name, role, team_id FROM profiles WHERE id = $1`, id,
	).Scan(&p.ID, &p.DisplayName, &p.Role, &p.TeamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return buddy.Profile{}, buddy.ErrNotFound
	}
	if err != nil {
		return buddy.Profile{}, fmt.Errorf("profile by id: %w", err)
	}
	return p, nil
}

func (s *Store) CreateSession(ctx context.Context, sess buddy.Session) error {
	_, err := s.q.Exec(ctx,
		`INSERT INTO sessions (token_hash, profile_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (token_hash) DO NOTHING`,
		sess.TokenHash, sess.ProfileID, sess.ExpiresAt,
	)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

func (s *Store) ProfileBySessionHash(ctx context.Context, hash string) (buddy.Profile, error) {
	var p buddy.Profile
	err := s.q.QueryRow(ctx, `
		SELECT p.id, p.display_name, p.role, p.team_id
		FROM sessions s
		JOIN profiles p ON p.id = s.profile_id
		WHERE s.token_hash = $1 AND s.expires_at > now()`, hash,
	).Scan(&p.ID, &p.DisplayName, &p.Role, &p.TeamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return buddy.Profile{}, buddy.ErrNotFound
	}
	if err != nil {
		return buddy.Profile{}, fmt.Errorf("profile by session: %w", err)
	}
	return p, nil
}
