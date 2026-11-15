package httpapi

import (
	"net/http"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

type notificationDTO struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Text        string `json:"text"`
	ActionTitle string `json:"action_title"`
	ActionURL   string `json:"action_url"`
	Read        bool   `json:"read"`
}

func toNotificationDTO(n buddy.Notification) notificationDTO {
	return notificationDTO{
		ID: n.ID, Kind: n.Kind, Title: n.Title, Text: n.Body,
		ActionTitle: n.ActionTitle, ActionURL: n.ActionURL, Read: n.Read,
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

func (a *API) handleReadNotifications(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		IDs []string `json:"ids"`
	}
	if decodeJSON(w, r, &payload) != nil || len(payload.IDs) == 0 || len(payload.IDs) > 100 {
		writeError(w, buddy.ErrInvalidInput)
		return
	}
	profile, _ := profileFrom(r.Context())
	if err := a.notifications.MarkRead(r.Context(), profile.ID, payload.IDs); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
