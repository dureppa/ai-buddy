package buddy

import (
	"context"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestChecklistContextValidation(t *testing.T) {
	task := &SelectionResource{Kind: "task", ID: "local-task", Label: "Текущий пункт"}
	for _, tc := range []struct {
		name  string
		value ChecklistContext
		valid bool
	}{
		{"in progress", ChecklistContext{Status: "in_progress", Task: task}, true},
		{"completed", ChecklistContext{Status: "completed"}, true},
		{"missing task", ChecklistContext{Status: "in_progress"}, false},
		{"completed with task", ChecklistContext{Status: "completed", Task: task}, false},
		{"unknown status", ChecklistContext{Status: "pending", Task: task}, false},
		{"foreign kind", ChecklistContext{Status: "in_progress", Task: &SelectionResource{Kind: "confluence", ID: "x"}}, false},
		{"invalid task", ChecklistContext{Status: "in_progress", Task: &SelectionResource{Kind: "task", ID: "bad id", Label: "x"}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) { require.Equal(t, tc.valid, tc.value.Valid()) })
	}
}

func TestChatRejectsInvalidChecklistContext(t *testing.T) {
	chat := NewChat(UnavailableAssistant{})
	for _, msg := range []ChatMessage{
		{Text: "Что дальше?", Checklist: &ChecklistContext{Status: "completed"}},
		{Text: "Что дальше?", PageURL: "https://buddy.example/", Checklist: &ChecklistContext{Status: "invalid"}},
	} {
		_, err := chat.Ask(context.Background(), "olga", msg)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	_, err := chat.Ask(context.Background(), "olga", ChatMessage{Text: "Что дальше?", PageURL: "https://buddy.example/", Checklist: &ChecklistContext{Status: "completed"}})
	require.ErrorIs(t, err, ErrUnavailable)
}
