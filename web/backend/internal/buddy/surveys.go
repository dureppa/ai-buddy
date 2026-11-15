package buddy

import (
	"strings"
	"unicode/utf8"
)

var surveyQuestions = map[string][2]string{
	"first":    {"tasks", "access"},
	"midpoint": {"feedback", "goals"},
	"final":    {"outcomes", "usefulness"},
}

func ValidSurveyAnswers(stage string, answers map[string]string) bool {
	questions, exists := surveyQuestions[stage]
	if !exists {
		return false
	}

	for _, key := range []string{"mentor", "hr_bp", "buddy", "frequency", questions[0], questions[1]} {
		switch answers[key] {
		case "1", "2", "3", "4", "5":
		case "na":
			if key != "mentor" && key != "hr_bp" && key != "buddy" {
				return false
			}
		default:
			return false
		}
	}
	comment, hasComment := answers["comment"]
	if hasComment {
		return len(answers) == 7 && utf8.RuneCountInString(comment) <= 1000 && !strings.ContainsRune(comment, 0)
	}
	return len(answers) == 6
}
