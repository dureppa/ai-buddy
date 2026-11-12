package httpapi

import (
	"net/http"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type chatRequest struct {
	Text           string `json:"text"`
	ConversationID string `json:"conversation_id,omitempty"`
	PageContext    struct {
		URL string `json:"url"`
	} `json:"page_context,omitempty"`
}

func (a *API) handleAskBuddy(w http.ResponseWriter, r *http.Request) {
	var req chatRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)
		return
	}

	msg := buddy.ChatMessage{
		Text:           req.Text,
		ConversationID: req.ConversationID,
		PageURL:        req.PageContext.URL,
	}

	p, _ := profileFrom(r.Context())
	err := a.chat.Ask(r.Context(), p.ID, msg)
	if err != nil {
		writeError(w, err)
		return
	}
	// В будущем здесь будет writeJSON с ChatReply, пока ассистент всегда возвращает ошибку.
}
