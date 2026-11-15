package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateTeamGuide(t *testing.T) {
	brief := buddy.TeamGuideBrief{Team: "Доставка", Product: "Авито", Brief: "Работаем над оформлением заказа"}
	val := []buddy.TeamGuideCard{{Title: "Команда", Text: "Задачи команды"}, {Title: "Продукт", Text: "Путь заказа"}, {Title: "Первые шаги", Text: "Изучи материалы"}}
	for _, tc := range []struct {
		name, raw string
		cards     []buddy.TeamGuideCard
	}{
		{"accepted", "", val},
		{"wrong counts", "", val[:2]},
		{"blank card", "", []buddy.TeamGuideCard{val[0], val[1], {Title: " ", Text: "Что почитать"}}},
		{"overlong card", "", []buddy.TeamGuideCard{val[0], val[1], {Title: "Шаг", Text: strings.Repeat("я", 281)}}},
		{"invalid JSON", "{invalid}", nil},
		{"trailing JSON", `{"cards":[]}{}`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/internal/v1/team-guide", r.URL.Path)
				assert.Equal(t, "Bearer service-token-long", r.Header.Get("Authorization"))
				var got buddy.TeamGuideBrief
				assert.NoError(t, json.NewDecoder(r.Body).Decode(&got))
				assert.Equal(t, brief, got)
				if tc.raw != "" {
					_, _ = w.Write([]byte(tc.raw))
					return
				}
				write(w, 200, buddy.TeamGuide{Cards: tc.cards})
			}))
			defer server.Close()
			b, _ := newBridge(t, server.URL)
			cards, err := b.GenerateTeamGuide(t.Context(), brief)
			if tc.name == "accepted" {
				require.NoError(t, err)
				require.Equal(t, val, cards)
				return
			}
			require.ErrorIs(t, err, buddy.ErrUnavailable)
		})
	}
}
