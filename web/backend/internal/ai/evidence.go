package ai

import (
	"context"
	"time"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
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
	refURL := taskPage(task)
	switch task {
	case "consent-news":
		refURL = b.PublicConsentURL
		read, err := b.consentEvidence(ctx, profile)
		if err != nil {
			return nil, err
		}
		items = read
	case "papers", "documents":
		refURL = b.PublicDocumentsURL
		read, err := b.guideEvidence(ctx, profile, b.DocumentsURL, "/api/v1/me/documents", "done", "памятка прочитана", "памятка ещё не прочитана")
		if err != nil {
			return nil, err
		}
		items = read
	case "events":
		refURL = b.PublicEventsURL
		read, err := b.guideEvidence(ctx, profile, b.EventsURL, "/api/v1/me/events", "registered", "вы записаны", "записи нет")
		if err != nil {
			return nil, err
		}
		items = read
	}
	return map[string]any{"task_id": task, "items": items, "references": []any{map[string]any{"id": "evidence:" + task, "title": "Подтверждения задания", "url": refURL, "version": "live-demo-v1", "is_demo": true}}}, nil
}

func (b *Bridge) consentEvidence(ctx context.Context, profile string) ([]any, error) {
	if b.HRURL == "" || b.HRSecret == "" {
		return nil, buddy.ErrUnavailable
	}
	var consents []struct {
		Purpose     string  `json:"purpose"`
		Title       string  `json:"title"`
		Description string  `json:"description"`
		Granted     bool    `json:"granted"`
		UpdatedAt   *string `json:"updated_at"`
	}
	if err := b.getJSON(ctx, b.HRURL+"/api/v1/me/consents", profile, &consents); err != nil {
		return nil, err
	}
	for _, c := range consents {
		if c.Purpose == "news" {
			version := "not-recorded"
			if c.UpdatedAt != nil {
				version = *c.UpdatedAt
			}
			return []any{map[string]any{"version": version, "kind": "consent", "confirmed": c.Granted, "summary": "Учебное согласие на внутренние новости; confirmed отражает текущее состояние сервиса."}}, nil
		}
	}
	return nil, buddy.ErrUnavailable
}

func (b *Bridge) guideEvidence(ctx context.Context, profile, base, path, flag, yes, no string) ([]any, error) {
	if base == "" || b.HRSecret == "" {
		return nil, buddy.ErrUnavailable
	}
	var rows []struct {
		ID         string  `json:"id"`
		Title      string  `json:"title"`
		Text       string  `json:"text"`
		Done       bool    `json:"done"`
		Registered bool    `json:"registered"`
		UpdatedAt  *string `json:"updated_at"`
	}
	if err := b.getJSON(ctx, base+path, profile, &rows); err != nil || len(rows) == 0 {
		return nil, buddy.ErrUnavailable
	}
	kind := "document"
	if flag == "registered" {
		kind = "event"
	}
	items := make([]any, 0, len(rows))
	for _, row := range rows {
		confirmed := row.Done
		if flag == "registered" {
			confirmed = row.Registered
		}
		version := "not-recorded"
		if row.UpdatedAt != nil {
			version = *row.UpdatedAt
		}
		state := no
		if confirmed {
			state = yes
		}
		items = append(items, map[string]any{"version": version, "kind": kind, "confirmed": confirmed, "summary": row.Title + ": " + state + "."})
	}
	return items, nil
}

func (b *Bridge) getJSON(ctx context.Context, endpoint, profile string, out any) error {
	token, _, err := buddy.NewTokens(b.HRSecret, 30*time.Second).Issue(profile, time.Now())
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()
	return b.request(ctx, "GET", endpoint, token, nil, out)
}
