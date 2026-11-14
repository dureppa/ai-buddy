package ai

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

func (b *Bridge) GenerateTeamGuide(ctx context.Context, brief buddy.TeamGuideBrief) ([]buddy.TeamGuideCard, error) {
	var guide buddy.TeamGuide
	if err := b.request(ctx, "POST", b.URL+"/internal/v1/team-guide", b.ServiceToken, brief, &guide); err != nil {
		return nil, err
	}
	if len(guide.Cards) != 3 {
		return nil, buddy.ErrUnavailable
	}
	for _, card := range guide.Cards {
		if strings.TrimSpace(card.Title) == "" || utf8.RuneCountInString(card.Title) > 80 ||
			strings.TrimSpace(card.Text) == "" || utf8.RuneCountInString(card.Text) > 280 {
			return nil, buddy.ErrUnavailable
		}
	}
	return guide.Cards, nil
}
