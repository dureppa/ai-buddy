package buddy

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidSurveyAnswers(t *testing.T) {
	for stage, questions := range map[string][2]string{
		"first": {"tasks", "access"}, "midpoint": {"feedback", "goals"}, "final": {"outcomes", "usefulness"},
	} {
		t.Run(stage, func(t *testing.T) {
			answers := map[string]string{
				"mentor": "na", "hr_bp": "3", "buddy": "5", "frequency": "1",
				questions[0]: "2", questions[1]: "4",
			}
			require.True(t, ValidSurveyAnswers(stage, answers))
			require.False(t, ValidSurveyAnswers("unknown", answers))
			answers["extra"] = "1"
			require.False(t, ValidSurveyAnswers(stage, answers))
			delete(answers, "extra")
			answers["comment"] = strings.Repeat("ю", 1000)
			require.True(t, ValidSurveyAnswers(stage, answers))
			answers["comment"] += "ю"
			require.False(t, ValidSurveyAnswers(stage, answers))
			answers["comment"] = "invalid\x00"
			require.False(t, ValidSurveyAnswers(stage, answers))
			delete(answers, "comment")
			answers["frequency"] = "na"
			require.False(t, ValidSurveyAnswers(stage, answers))
			answers["frequency"] = "6"
			require.False(t, ValidSurveyAnswers(stage, answers))
			delete(answers, questions[1])
			require.False(t, ValidSurveyAnswers(stage, answers))
		})
	}
}
