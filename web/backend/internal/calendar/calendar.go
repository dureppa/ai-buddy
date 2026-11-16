// Package calendar owns the personal calendar shared by the web and Buddy tools.
package calendar

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrInvalid = errors.New("invalid calendar input")
var ErrNotFound = errors.New("calendar event not found")
var eventID = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)
var Moscow = time.FixedZone("Europe/Moscow", 3*60*60)

type Event struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Kind        string    `json:"kind"`
	StartsAt    time.Time `json:"startsAt"`
	Tone        string    `json:"tone"`
	Description string    `json:"description"`
}
type Repository interface {
	List(context.Context, string, time.Time, time.Time, int) ([]Event, bool, error)
	Put(context.Context, string, Event, bool) (Event, error)
	Delete(context.Context, string, string) error
	Import(context.Context, string, []Event) error
}
type Service struct{ Store Repository }

func Tone(kind string) string {
	switch kind {
	case "Встреча":
		return "mint"
	case "Созвон":
		return "blue"
	case "Напоминание":
		return "lilac"
	}
	return ""
}
func Validate(e Event, future bool, now time.Time) error {
	if !eventID.MatchString(e.ID) || strings.TrimSpace(e.Title) == "" || utf8.RuneCountInString(e.Title) > 120 || strings.ContainsRune(e.Title, 0) || Tone(e.Kind) == "" || e.StartsAt.IsZero() || e.StartsAt.Year() < 2000 || e.StartsAt.Year() > 2100 || utf8.RuneCountInString(e.Description) > 4000 || strings.ContainsRune(e.Description, 0) || (future && !e.StartsAt.After(now)) {
		return ErrInvalid
	}
	return nil
}

// Window returns inclusive calendar dates as a half-open Moscow time interval.
func Window(period, start, end string, now time.Time) (time.Time, time.Time, error) {
	today := now.In(Moscow)
	day := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, Moscow)
	first, last := day, day
	if start != "" || end != "" {
		if period != "" {
			return first, last, ErrInvalid
		}
		var err error
		first, err = time.ParseInLocation(time.DateOnly, start, Moscow)
		if err != nil {
			return first, last, ErrInvalid
		}
		last, err = time.ParseInLocation(time.DateOnly, end, Moscow)
		if err != nil {
			return first, last, ErrInvalid
		}
	} else {
		switch period {
		case "today":
		case "tomorrow":
			first = day.AddDate(0, 0, 1)
			last = first
		case "", "week", "next_week":
			offset := (int(day.Weekday()) + 6) % 7
			first = day.AddDate(0, 0, -offset)
			if period == "next_week" {
				first = first.AddDate(0, 0, 7)
			}
			last = first.AddDate(0, 0, 6)
		case "month":
			first = time.Date(day.Year(), day.Month(), 1, 0, 0, 0, 0, Moscow)
			last = first.AddDate(0, 1, -1)
		default:
			return first, last, ErrInvalid
		}
	}
	if first.Year() < 2000 || last.Year() > 2100 || last.Before(first) || last.Sub(first) > 365*24*time.Hour {
		return first, last, ErrInvalid
	}
	return first, last.AddDate(0, 0, 1), nil
}
func (s *Service) Put(ctx context.Context, profile string, e Event, createOnly bool) (Event, error) {
	e.Title = strings.TrimSpace(e.Title)
	e.StartsAt = e.StartsAt.UTC()
	e.Tone = Tone(e.Kind)
	if err := Validate(e, createOnly, time.Now()); err != nil {
		return Event{}, err
	}
	return s.Store.Put(ctx, profile, e, createOnly)
}
func (s *Service) Import(ctx context.Context, profile string, events []Event) error {
	if events == nil || len(events) > 500 {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for i := range events {
		e := &events[i]
		e.Title = strings.TrimSpace(e.Title)
		e.StartsAt = e.StartsAt.UTC()
		e.Tone = Tone(e.Kind)
		if Validate(*e, false, time.Now()) != nil || seen[e.ID] {
			return ErrInvalid
		}
		seen[e.ID] = true
	}
	return s.Store.Import(ctx, profile, events)
}
func (s *Service) Delete(ctx context.Context, profile, id string) error {
	if !eventID.MatchString(id) {
		return ErrInvalid
	}
	return s.Store.Delete(ctx, profile, id)
}
