package store

import (
	"context"
	"fmt"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

func (s *Store) OnboardingTasks(ctx context.Context, profileID string) ([]buddy.OnboardingTask, error) {
	rows, err := s.q.Query(ctx, `
		SELECT t.id, t.title, t.guidance, t.action_url, (p.task_id IS NOT NULL) AS completed
		FROM onboarding_tasks t
		LEFT JOIN onboarding_progress p ON p.task_id = t.id AND p.profile_id = $1
		ORDER BY t.sort_order`, profileID)
	if err != nil {
		return nil, fmt.Errorf("onboarding tasks: %w", err)
	}
	defer rows.Close()

	tasks := make([]buddy.OnboardingTask, 0)
	for rows.Next() {
		var t buddy.OnboardingTask
		if err := rows.Scan(&t.ID, &t.Title, &t.Guidance, &t.ActionURL, &t.Completed); err != nil {
			return nil, fmt.Errorf("scan onboarding task: %w", err)
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

func (s *Store) TaskExists(ctx context.Context, taskID string) (bool, error) {
	var exists bool
	err := s.q.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM onboarding_tasks WHERE id = $1)`, taskID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("task exists: %w", err)
	}
	return exists, nil
}

func (s *Store) CompleteTask(ctx context.Context, profileID, taskID string) error {
	exists, err := s.TaskExists(ctx, taskID)
	if err != nil {
		return err
	}
	if !exists {
		return buddy.ErrNotFound
	}
	_, err = s.q.Exec(ctx,
		`INSERT INTO onboarding_progress (profile_id, task_id)
		 VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`, profileID, taskID)
	if err != nil {
		return fmt.Errorf("complete task: %w", err)
	}
	return nil
}
