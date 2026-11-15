package buddy

import (
	"context"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestSelectionValidationAndHistory(t *testing.T) {
	good := []SelectionResource{{Kind: "task", ID: "local-task", Label: "Задание", Description: "Описание"}, {Kind: "confluence", ID: "guide-access"}, {Kind: "jira", ID: "11111111-1111-4111-8111-111111111111"}, {Kind: "work_tool", ID: "funnel", Service: "redash"}, {Kind: "service", Service: "benefits"}}
	for _, r := range good {
		t.Run(r.Kind, func(t *testing.T) {
			a := &connectedAssistant{}
			chat := NewChat(a)
			msg := ChatMessage{Text: "Что это?", PageURL: "https://service.example/?secret=hidden#record", Selection: &Selection{Text: "Конверсия", Title: "Страница", Resource: &r}}
			_, err := chat.Ask(context.Background(), "olga", msg)
			require.NoError(t, err)
			require.Equal(t, "https://service.example/", a.message.PageURL)
			require.Contains(t, msg.HistoryText(), "Конверсия")
			require.NotContains(t, msg.HistoryText(), "secret")
		})
	}
	bad := []Selection{{Text: " ", Title: "x"}, {Text: strings.Repeat("я", 1201)}, {Text: "ok", Title: strings.Repeat("я", 201)}, {Text: "\x00"}, {Text: "ok", Resource: &SelectionResource{Kind: "task", ID: "x"}}, {Text: "ok", Resource: &SelectionResource{Kind: "work_tool", ID: "x", Service: "redash|trino"}}, {Text: "ok", Resource: &SelectionResource{Kind: "jira", ID: "DEL-1"}}, {Text: "ok", Resource: &SelectionResource{Kind: "service", Service: "benefits", ID: "secret"}}, {Text: "ok", Resource: &SelectionResource{Kind: "confluence", ID: "x", Description: "bad"}}, {Text: "ok", Resource: &SelectionResource{Kind: "unknown"}}, {Text: "ok", Resource: &SelectionResource{Kind: "task", ID: "x", Label: "\x00"}}}
	for _, s := range bad {
		require.False(t, s.Valid())
	}
	chat := NewChat(&connectedAssistant{})
	for _, msg := range []ChatMessage{{Text: "Hi", Selection: &Selection{Text: "ok"}}, {Text: strings.Repeat("я", 701), PageURL: "https://ok/", Selection: &Selection{Text: "ok"}}} {
		_, err := chat.Ask(context.Background(), "olga", msg)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	require.Equal(t, "hi", (ChatMessage{Text: "hi"}).HistoryText())
}

func TestSelectionRelatedPageLimits(t *testing.T) {
	for _, c := range []struct {
		kind  string
		ids   []string
		valid bool
	}{{"task", []string{"guide-access"}, true}, {"task", []string{"x", "x"}, false}, {"task", []string{"a", "b", "c", "d"}, false}, {"task", []string{"bad id"}, false}, {"confluence", []string{"x"}, false}} {
		selection := Selection{Text: "Фрагмент", Resource: &SelectionResource{Kind: c.kind, ID: "task", Label: "Задание", PageIDs: c.ids}}
		require.Equal(t, c.valid, selection.Valid())
	}
}
