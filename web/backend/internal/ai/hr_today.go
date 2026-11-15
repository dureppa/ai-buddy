package ai

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

func scheduleQuestion(message string) bool {
	message = strings.ToLower(message)
	for _, word := range []string{"сегодня", "отпуск", "командиров", "поездк", "расписан", "отсутств"} {
		if strings.Contains(message, word) {
			return true
		}
	}
	return false
}

type hrSummary struct {
	Requests []struct {
		ID, Status, Start, End, Date, Destination string
	}
	Destinations []struct{ ID, Title string }
}

func (b *Bridge) TodayHR(ctx context.Context, profile string) buddy.HRToday {
	today := time.Now().In(time.FixedZone("Moscow", 3*60*60)).Format(time.DateOnly)
	out := buddy.HRToday{Events: []buddy.HREvent{}, Unavailable: []string{}}
	for _, source := range []struct{ name, base, endpoint string }{
		{"absences", b.AbsencesURL, "/api/v1/me/absence-summary"},
		{"trips", b.TripsURL, "/api/v1/me/travel-summary"},
	} {
		var raw json.RawMessage
		var summary hrSummary
		if source.base == "" || b.getJSON(ctx, source.base+source.endpoint, profile, &raw) != nil ||
			json.Unmarshal(raw, &summary) != nil || summary.Requests == nil {
			out.Unavailable = append(out.Unavailable, source.name)
			continue
		}
		out.Events = append(out.Events, summary.eventsOn(source.name, today)...)
	}
	return out
}

func (s hrSummary) eventsOn(service, today string) []buddy.HREvent {
	var events []buddy.HREvent
	for _, row := range s.Requests {
		status := "На согласовании"
		if row.Status == "approved" {
			status = "Согласовано"
		} else if row.Status != "pending" {
			continue
		}
		event := buddy.HREvent{ID: service + "-" + row.ID, Service: service}
		if service == "absences" {
			if row.Start == "" || today < row.Start || today > row.End {
				continue
			}
			event.Title = "Сегодня в отпуске"
			if row.Status == "pending" {
				event.Title = "Сегодня · заявка на отпуск"
			}
			event.Detail = "Отсутствия · " + status
		} else {
			if row.Date != today {
				continue
			}
			event.Title = "Сегодня в командировке"
			if row.Status == "pending" {
				event.Title = "Сегодня · заявка на командировку"
			}
			city := "Командировки"
			for _, destination := range s.Destinations {
				if destination.ID == row.Destination {
					city = destination.Title
					break
				}
			}
			event.Detail = city + " · " + status
		}
		events = append(events, event)
	}
	return events
}
