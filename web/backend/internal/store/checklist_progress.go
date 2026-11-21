package store

import (
	"context"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ChecklistExtras(ctx context.Context, profile string) ([]buddy.ChecklistExtra, error) {
	rows, err := s.q.Query(ctx, `SELECT id, stage, title, summary, done FROM role_checklist_extras
  WHERE profile_id=$1 ORDER BY created_at DESC, id`, profile)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[buddy.ChecklistExtra])
}

func (s *Store) TeamInternIDs(ctx context.Context, team string) ([]string, error) {
	rows, err := s.q.Query(ctx, `SELECT id FROM profiles
  WHERE team_id=$1 AND job_role IN ('analyst','backend','tester','designer') ORDER BY id`, team)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (s *Store) AddChecklistExtra(ctx context.Context, profile string, input buddy.ChecklistExtraInput) error {
	_, err := s.q.Exec(ctx, `INSERT INTO role_checklist_extras(profile_id,stage,title,summary) VALUES($1,$2,$3,$4)`,
		profile, input.Stage, input.Title, input.Summary)
	return err
}

func (s *Store) DeleteChecklistExtra(ctx context.Context, profile, id string) error {
	result, err := s.q.Exec(ctx, "DELETE FROM role_checklist_extras WHERE profile_id=$1 AND id=$2", profile, id)
	if err == nil && result.RowsAffected() == 0 {
		return buddy.ErrNotFound
	}
	return err
}

func (s *Store) CompleteChecklistExtra(ctx context.Context, profile, id string, done bool) error {
	result, err := s.q.Exec(ctx, "UPDATE role_checklist_extras SET done=$3 WHERE profile_id=$1 AND id=$2", profile, id, done)
	if err == nil && result.RowsAffected() == 0 {
		return buddy.ErrNotFound
	}
	return err
}
