package ai

import (
	"regexp"
	"strings"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

var requestAccess = regexp.MustCompile(`(?i)^(?:пожалуйста[,!.]?\s*)?(?:запроси|оформи|подай|создай|отправь)(?:те)?\s+.{0,100}(?:доступ|заявк)`)
var noSubmit = regexp.MustCompile(`(?i)не\s+(?:отправ|подавай|подтвержд|оформляй)|черновик|без\s+отправки`)
var confirmAccess = regexp.MustCompile(`(?i)^(?:да[,!.]?\s*)?(?:отправляй|отправь заявку|подтверждаю)[.!]?$`)

// AccessIntent grants this turn only. Documents and model-generated text never grant it.
func AccessIntent(message string, history []buddy.HistoryMessage) bool {
	message = strings.Join(strings.Fields(message), " ")
	if noSubmit.MatchString(message) {
		return false
	}
	if requestAccess.MatchString(message) {
		return true
	}
	if !confirmAccess.MatchString(message) || len(history) == 0 {
		return false
	}
	last := history[len(history)-1]
	if last.Role != "assistant" || (!strings.Contains(strings.ToLower(last.Content), "доступ") && !strings.Contains(strings.ToLower(last.Content), "заявк")) {
		return false
	}
	// Only recent conversation can confirm a request; cancellation or draft intent revokes it.
	for i := len(history) - 2; i >= max(0, len(history)-8); i-- {
		if history[i].Role == "user" {
			text := strings.TrimSpace(history[i].Content)
			if noSubmit.MatchString(text) || strings.Contains(strings.ToLower(text), "отмен") {
				return false
			}
			if requestAccess.MatchString(text) {
				return true
			}
		}
	}
	return false
}
