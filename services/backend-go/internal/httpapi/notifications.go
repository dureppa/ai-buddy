package httpapi

import (
	"net/http"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type notificationDTO struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Text        string `json:"text"`
	ActionTitle string `json:"action_title"`
	ActionURL   string `json:"action_url"`
}

func toNotificationDTO(n buddy.Notification) notificationDTO {
	return notificationDTO{
		ID: n.ID, Kind: n.Kind, Title: n.Title, Text: n.Body,
		ActionTitle: n.ActionTitle, ActionURL: n.ActionURL,
	}
}

func toNotificationListDTO(notifs []buddy.Notification) []notificationDTO {
	dto := make([]notificationDTO, 0, len(notifs))
	for _, n := range notifs {
		dto = append(dto, toNotificationDTO(n))
	}
	return dto
}

func (a *API) handleListNotifications(w http.ResponseWriter, r *http.Request) {
	p, _ := profileFrom(r.Context())
	notifs, err := a.notifications.List(r.Context(), p.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toNotificationListDTO(notifs))
}
