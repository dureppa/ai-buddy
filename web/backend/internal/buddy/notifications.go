package buddy

import "context"

type Notification struct {
	ID          string
	Kind        string
	Title       string
	Body        string
	ActionTitle string
	ActionURL   string
	Read        bool
}

type notificationStore interface {
	ListNotificationsByProfile(ctx context.Context, profileID string) ([]Notification, error)
	MarkNotificationsRead(ctx context.Context, profileID string, ids []string) error
}

type Notifications struct {
	store notificationStore
}

func NewNotifications(store notificationStore) *Notifications {
	return &Notifications{store: store}
}

func (s *Notifications) List(ctx context.Context, profileID string) ([]Notification, error) {
	return s.store.ListNotificationsByProfile(ctx, profileID)
}

func (s *Notifications) MarkRead(ctx context.Context, profileID string, ids []string) error {
	return s.store.MarkNotificationsRead(ctx, profileID, ids)
}
