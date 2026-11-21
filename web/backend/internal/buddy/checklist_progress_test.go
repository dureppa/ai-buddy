package buddy

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestChecklistProgressOnlyCountsCompletedTasks(t *testing.T) {
	extra := ChecklistExtra{ID: "extra-example"}
	pending := checklistProgress("olga", []string{"meet-team", "meet-team", "consent-news", "internship-survey-first"}, nil, []ChecklistExtra{extra})
	require.Equal(t, []string{"meet-team"}, pending.Completed)
	require.Equal(t, len(roleChecklist.Tasks)+1, pending.Total)
	var marks, surveys []string
	for _, task := range roleChecklist.Tasks {
		if task.Survey == "" {
			marks = append(marks, task.ID)
		} else {
			surveys = append(surveys, task.Survey)
		}
	}
	extra.Done = true
	complete := checklistProgress("olga", marks, surveys, []ChecklistExtra{extra})
	require.Equal(t, 100, complete.Percent)
	require.Len(t, complete.Completed, complete.Total)
}
