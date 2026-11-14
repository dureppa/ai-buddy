package ai

import (
	"context"
	"time"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

func (b *Bridge) evidence(ctx context.Context, profile string, args map[string]any) (map[string]any, error) {
	task, ok := args["task_id"].(string)
	if !ok || len(args) != 1 {
		return nil, buddy.ErrInvalidInput
	}
	if _, err := b.Store.ReadAI(ctx, profile, "get_task_context", args); err != nil {
		return nil, err
	}
	items := []any{}
	if task == "consent-news" {
		if b.HRURL == "" || b.HRSecret == "" {
			return nil, buddy.ErrUnavailable
		}
		token, _, err := buddy.NewTokens(b.HRSecret, 30*time.Second).Issue(profile, time.Now())
		if err != nil {
			return nil, err
		}
		var consents []struct {
			Purpose     string  `json:"purpose"`
			Title       string  `json:"title"`
			Description string  `json:"description"`
			Granted     bool    `json:"granted"`
			UpdatedAt   *string `json:"updated_at"`
		}
		ctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
		defer cancel()
		if err = b.request(ctx, "GET", b.HRURL+"/api/v1/me/consents", token, nil, &consents); err != nil {
			return nil, err
		}
		found := false
		for _, c := range consents {
			if c.Purpose == "news" {
				found = true
				version := "not-recorded"
				if c.UpdatedAt != nil {
					version = *c.UpdatedAt
				}
				items = append(items, map[string]any{"version": version, "kind": "consent", "confirmed": c.Granted, "summary": "Учебное согласие на внутренние новости; confirmed отражает текущее состояние сервиса."})
			}
		}
		if !found {
			return nil, buddy.ErrUnavailable
		}
	}
	return map[string]any{"task_id": task, "items": items, "references": []any{map[string]any{"id": "evidence:" + task, "title": "Подтверждения задания", "url": b.PublicConsentURL, "version": "live-demo-v1", "is_demo": true}}}, nil
}
