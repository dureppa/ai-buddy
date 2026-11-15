package store

import (
	"context"
	"fmt"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

func (s *Store) ListNotificationsByProfile(ctx context.Context, profileID string) ([]buddy.Notification, error) {
	rows, err := s.q.Query(ctx, `
		SELECT id, kind, title, body, action_title, action_url, read_at IS NOT NULL
		FROM notifications
		WHERE profile_id = $1
		  AND NOT EXISTS (
		    SELECT 1 FROM internship_survey_responses
		    WHERE profile_id = $1 AND action_url = '/onboarding?survey=' || stage
		  )
		ORDER BY created_at DESC`, profileID)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()

	var notifs []buddy.Notification
	for rows.Next() {
		var n buddy.Notification
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.ActionTitle, &n.ActionURL, &n.Read); err != nil {
			return nil, fmt.Errorf("scan notification: %w", err)
		}
		notifs = append(notifs, n)
	}
	return notifs, rows.Err()
}

func (s *Store) MarkNotificationsRead(ctx context.Context, profileID string, ids []string) error {
	_, err := s.q.Exec(ctx, `
		UPDATE notifications SET read_at = now()
		WHERE profile_id = $1 AND read_at IS NULL AND id::text = ANY($2::text[])`, profileID, ids)
	return err
}
