package store

import (
	"context"
	"fmt"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

func (s *Store) ListNotificationsByProfile(ctx context.Context, profileID string) ([]buddy.Notification, error) {
	rows, err := s.q.Query(ctx, `
		SELECT id, kind, title, body, action_title, action_url
		FROM notifications
		WHERE profile_id = $1
		ORDER BY created_at DESC`, profileID)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()

	var notifs []buddy.Notification
	for rows.Next() {
		var n buddy.Notification
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.ActionTitle, &n.ActionURL); err != nil {
			return nil, fmt.Errorf("scan notification: %w", err)
		}
		notifs = append(notifs, n)
	}
	return notifs, rows.Err()
}
