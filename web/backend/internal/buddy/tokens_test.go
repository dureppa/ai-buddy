package buddy

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTokensParse(t *testing.T) {
	tokens := NewTokens(strings.Repeat("k", 32), time.Hour)
	other := NewTokens(strings.Repeat("x", 32), time.Hour)

	valid, _, err := tokens.Issue("olga", time.Now())
	require.NoError(t, err)
	expired, _, err := tokens.Issue("olga", time.Now().Add(-2*time.Hour))
	require.NoError(t, err)
	foreign, _, err := other.Issue("olga", time.Now())
	require.NoError(t, err)

	tests := []struct {
		name    string
		token   string
		wantSub string
		wantErr bool
	}{
		{"валидный токен", valid, "olga", false},
		{"истёкший токен", expired, "", true},
		{"чужая подпись", foreign, "", true},
		{"повреждённый токен", valid + "x", "", true},
		{"пустая строка", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub, err := tokens.Parse(tt.token)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.wantSub, sub)
		})
	}
}

func TestTokensIssueEmptyProfile(t *testing.T) {
	tokens := NewTokens(strings.Repeat("k", 32), time.Hour)
	_, _, err := tokens.Issue("", time.Now())
	require.Error(t, err)
}

func TestHashToken(t *testing.T) {
	require.Equal(t,
		"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		HashToken("abc"),
	)
}
