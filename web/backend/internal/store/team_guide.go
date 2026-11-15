package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/jackc/pgx/v5"
)

func (s *Store) QueueTeamGuide(ctx context.Context, team string, retry bool) error {
	_, err := s.q.Exec(ctx, `
		INSERT INTO team_guides (team_id, status)
		SELECT id, 'pending' FROM teams WHERE id = $1 AND guide_brief IS NOT NULL
		ON CONFLICT (team_id) DO UPDATE SET status = 'pending', lease_until = '-infinity'
		WHERE team_guides.status = 'failed' AND $2`, team, retry)
	return err
}

func (s *Store) ReadTeamGuide(ctx context.Context, team string) (buddy.TeamGuide, error) {
	var guide buddy.TeamGuide
	err := s.q.QueryRow(ctx, "SELECT status, cards FROM team_guides WHERE team_id = $1", team).Scan(&guide.Status, &guide.Cards)
	if errors.Is(err, pgx.ErrNoRows) {
		return buddy.TeamGuide{Status: "missing"}, nil
	}
	return guide, err
}

func (s *Store) GenerateNextTeamGuide(ctx context.Context, generate func(context.Context, buddy.TeamGuideBrief) ([]buddy.TeamGuideCard, error)) error {
	var id string
	var attempt int64
	var brief buddy.TeamGuideBrief
	err := s.q.QueryRow(ctx, `
		WITH next AS (
			SELECT team_id FROM team_guides WHERE status = 'pending' AND lease_until <= now()
			ORDER BY lease_until, team_id LIMIT 1 FOR UPDATE SKIP LOCKED
		)
		UPDATE team_guides AS guide SET lease_until = now() + interval '60 seconds', attempt = attempt + 1
		FROM next, teams
		WHERE guide.team_id = next.team_id AND teams.id = guide.team_id
		RETURNING guide.team_id, guide.attempt, teams.name, teams.product, teams.guide_brief`,
	).Scan(&id, &attempt, &brief.Team, &brief.Product, &brief.Brief)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	cards, err := generate(ctx, brief)
	status := "failed"
	var result json.RawMessage
	if err == nil {
		result, err = json.Marshal(cards)
		if err == nil {
			status = "ready"
		}
	}
	_, saveErr := s.q.Exec(ctx, `UPDATE team_guides SET status = $3, cards = $4
		WHERE team_id = $1 AND attempt = $2 AND status = 'pending'`, id, attempt, status, result)
	return errors.Join(err, saveErr)
}
