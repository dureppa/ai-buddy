package buddy

import (
	"context"
	"strings"
)

type ChatMessage struct {
	Text           string
	ConversationID string
	PageURL        string
}

type assistant interface {
	Ask(ctx context.Context, msg ChatMessage) error
}

// UnavailableAssistant — заглушка до подключения Python-сервиса.
type UnavailableAssistant struct{}

func (UnavailableAssistant) Ask(context.Context, ChatMessage) error {
	return ErrUnavailable
}

type Chat struct {
	assistant assistant
}

func NewChat(a assistant) *Chat {
	return &Chat{assistant: a}
}

func (s *Chat) Ask(ctx context.Context, profileID string, msg ChatMessage) error {
	if strings.TrimSpace(msg.Text) == "" {
		return ErrInvalidInput
	}
	if msg.PageURL != "" &&
		!strings.HasPrefix(msg.PageURL, "http://") &&
		!strings.HasPrefix(msg.PageURL, "https://") {
		return ErrInvalidInput
	}
	return s.assistant.Ask(ctx, msg)
}
