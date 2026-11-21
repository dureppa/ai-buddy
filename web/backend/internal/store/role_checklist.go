package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

func (s *Store) RoleChecklistMarks(ctx context.Context, profile string) ([]string, error) {
	var marks []string
	err := s.q.QueryRow(ctx, "SELECT completed_ids FROM role_checklist_progress WHERE profile_id = $1", profile).Scan(&marks)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return marks, err
}

func (s *Store) UpdateRoleChecklist(ctx context.Context, profile string, update func([]string, []string) ([]string, error)) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Serialize all role-checklist writes for this profile, including the first write.
		var locked string
		if err := tx.QueryRow(ctx, "SELECT id FROM profiles WHERE id = $1 FOR UPDATE", profile).Scan(&locked); err != nil {
			return err
		}
		view := &Store{q: tx}
		marks, err := view.RoleChecklistMarks(ctx, profile)
		if err != nil {
			return err
		}
		surveys, err := view.CompletedSurveys(ctx, profile)
		if err != nil {
			return err
		}
		marks, err = update(marks, surveys)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO role_checklist_progress (profile_id, completed_ids)
			VALUES ($1, $2) ON CONFLICT (profile_id) DO UPDATE SET completed_ids = EXCLUDED.completed_ids`, profile, marks)
		return err
	})
}
