package httpapi

import (
	"net/http"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
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
	reply, err := a.chat.Ask(r.Context(), p.ID, msg)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, reply)
}

func (a *API) handleConversation(w http.ResponseWriter, r *http.Request) {
	p, _ := profileFrom(r.Context())
	messages, err := a.chat.Conversation(r.Context(), p.ID, r.PathValue("conversation_id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"conversation_id": r.PathValue("conversation_id"), "messages": messages})
}

func (a *API) handleReview(w http.ResponseWriter, r *http.Request) {
	p, _ := profileFrom(r.Context())
	var result buddy.TaskReview
	var err error
	if r.Method == "POST" {
		var in struct {
			Answer string `json:"answer"`
		}
		if e := decodeJSON(w, r, &in); e != nil {
			writeError(w, e)
			return
		}
		result, err = a.chat.SubmitReview(r.Context(), p.ID, in.Answer)
	} else {
		result, err = a.chat.Review(r.Context(), p.ID)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, result)
}
