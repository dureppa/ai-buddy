package serviceactions

import (
	"context"
	"errors"
	"github.com/dureppa/ai-buddy/web/backend/internal/calendar"
	"time"
)

func calendarEvent(id string, p map[string]any) (calendar.Event, error) {
	if _, ok := p["title"].(string); !ok {
		return calendar.Event{}, ErrInvalid
	}
	if _, ok := p["description"].(string); !ok {
		return calendar.Event{}, ErrInvalid
	}
	starts, err := time.Parse(time.RFC3339, stringValue(p, "starts_at"))
	if err != nil {
		return calendar.Event{}, ErrInvalid
	}
	e := calendar.Event{ID: id, Title: stringValue(p, "title"), Kind: stringValue(p, "kind"), StartsAt: starts.UTC(), Description: stringValue(p, "description")}
	if calendar.Validate(e, true, time.Now()) != nil {
		return calendar.Event{}, ErrInvalid
	}
	return e, nil
}
func (s *Service) planCalendar(p map[string]any) (Draft, error) {
	if s.Calendar == nil {
		return Draft{}, ErrUnavailable
	}
	e, err := calendarEvent("pending", p)
	if err != nil {
		return Draft{}, err
	}
	return Draft{Title: "Создать событие в календаре", ServiceURL: "/events", Fields: []Field{{Label: "Название", Value: e.Title}, {Label: "Тип", Value: e.Kind}, {Label: "Дата и время (Москва)", Value: e.StartsAt.In(calendar.Moscow).Format("02.01.2006 15:04")}, {Label: "Описание", Value: e.Description}}}, nil
}
func (s *Service) executeCalendar(ctx context.Context, profile string, d Draft, p map[string]any) error {
	if s.Calendar == nil {
		return ErrUnavailable
	}
	e, err := calendarEvent(d.ID, p)
	if err != nil {
		return err
	}
	_, err = s.Calendar.Put(ctx, profile, e, true)
	if errors.Is(err, calendar.ErrInvalid) {
		return ErrInvalid
	}
	return err
}
func (s *Service) calendarContext(ctx context.Context, profile string, in contextArgs) (map[string]any, error) {
	if s.Calendar == nil {
		return nil, ErrUnavailable
	}
	now := time.Now()
	from, to, err := calendar.Window(in.Period, in.StartDate, in.EndDate, now)
	if err != nil {
		return nil, ErrInvalid
	}
	events, more, err := s.Calendar.Store.List(ctx, profile, from, to, 30)
	if err != nil {
		return nil, ErrUnavailable
	}
	rows := make([]any, 0, len(events))
	for _, event := range events {
		rows = append(rows, event)
	}
	return boundContext(map[string]any{"service": "calendar", "today": now.In(calendar.Moscow).Format(time.DateOnly), "timezone": "Europe/Moscow", "start_date": from.Format(time.DateOnly), "end_date": to.AddDate(0, 0, -1).Format(time.DateOnly), "events": rows, "has_more": more, "references": []any{source("calendar", "Календарь событий", "/events")}}, []string{"events"})
}
