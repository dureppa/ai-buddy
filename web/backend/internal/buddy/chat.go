package buddy

import (
	"context"
	"net/url"
	"strings"
	"unicode/utf8"
)

type ChatMessage struct {
	Text           string
	ConversationID string
	PageURL        string
	Selection      *Selection
	Checklist      *ChecklistContext
}

type assistant interface {
	Ask(ctx context.Context, profileID string, msg ChatMessage) (ChatReply, error)
}

// UnavailableAssistant — заглушка до подключения Python-сервиса.
type UnavailableAssistant struct{}

func (UnavailableAssistant) Ask(context.Context, string, ChatMessage) (ChatReply, error) {
	return ChatReply{}, ErrUnavailable
}

type Chat struct {
	assistant assistant
}

func NewChat(a assistant) *Chat {
	return &Chat{assistant: a}
}

func (s *Chat) Ask(ctx context.Context, profileID string, msg ChatMessage) (ChatReply, error) {
	if strings.TrimSpace(msg.Text) == "" || utf8.RuneCountInString(msg.Text) > 4000 {
		return ChatReply{}, ErrInvalidInput
	}
	if msg.Selection != nil && (msg.PageURL == "" || utf8.RuneCountInString(msg.Text) > 700 || len(msg.PageURL) > 2048 || !msg.Selection.Valid()) {
		return ChatReply{}, ErrInvalidInput
	}
	if msg.Checklist != nil && (msg.PageURL == "" || len(msg.PageURL) > 2048 || !msg.Checklist.Valid()) {
		return ChatReply{}, ErrInvalidInput
	}
	if msg.PageURL != "" {
		u, err := url.Parse(msg.PageURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || strings.ContainsAny(msg.PageURL, "\\\r\n") {
			return ChatReply{}, ErrInvalidInput
		}
		u.RawQuery, u.Fragment, u.RawFragment = "", "", ""
		u.ForceQuery = false
		msg.PageURL = u.String()
	}
	return s.assistant.Ask(ctx, profileID, msg)
}

type Reference struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}
type ChatReply struct {
	ConversationID string      `json:"conversation_id"`
	Kind           string      `json:"kind"`
	Text           string      `json:"text"`
	References     []Reference `json:"references"`
}
type HistoryMessage struct {
	References []Reference `json:"references,omitempty"`
	Role       string      `json:"role"`
	Content    string      `json:"content"`
}

func (s *Chat) Conversation(ctx context.Context, profile, id string) ([]HistoryMessage, error) {
	reader, ok := s.assistant.(interface {
		Conversation(context.Context, string, string) ([]HistoryMessage, error)
	})
	if !ok {
		return nil, ErrUnavailable
	}
	return reader.Conversation(ctx, profile, id)
}

func (s *Chat) Review(ctx context.Context, profile string) (TaskReview, error) {
	a, ok := s.assistant.(interface {
		Review(context.Context, string) (TaskReview, error)
	})
	if !ok {
		return TaskReview{}, ErrUnavailable
	}
	return a.Review(ctx, profile)
}
func (s *Chat) SubmitReview(ctx context.Context, profile, answer string) (TaskReview, error) {
	a, ok := s.assistant.(interface {
		SubmitReview(context.Context, string, string) (TaskReview, error)
	})
	if !ok {
		return TaskReview{}, ErrUnavailable
	}
	return a.SubmitReview(ctx, profile, answer)
}

// KnowledgeSearchQuery expands a colloquial term without generating an answer.
func KnowledgeSearchQuery(query string) string {
	if strings.Contains(strings.ToLower(query), "отгул") && !strings.Contains(strings.ToLower(query), "отпуск") {
		const suffix = " отпуск"
		runes := []rune(query)
		return string(runes[:min(len(runes), 500-utf8.RuneCountInString(suffix))]) + suffix
	}
	return query
}
