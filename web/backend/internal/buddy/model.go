package buddy

import "time"

type Profile struct {
	ID          string
	DisplayName string
	Role        string
	TeamID      string
}

type Session struct {
	TokenHash string
	ProfileID string
	ExpiresAt time.Time
}
