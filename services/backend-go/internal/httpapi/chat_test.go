package httpapi

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestChatHTTP(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		auth       bool
		wantStatus int
		wantBody   string
	}{
		{"без auth", `{"text":"привет"}`, false, 401, `"code":"unauthenticated"`},
		{"битый JSON", `{bad}`, true, 400, `"code":"invalid_input"`},
		{"пустой текст", `{"text":"   "}`, true, 400, `"code":"invalid_input"`},
		{"нет текста", `{}`, true, 400, `"code":"invalid_input"`},
		{"невалидный URL", `{"text":"привет","page_context":{"url":"ftp://bad"}}`, true, 400, `"code":"invalid_input"`},
		{"валидный запрос — AI недоступен", `{"text":"как оформить отгул?","page_context":{"url":"https://ok.example/tools"}}`, true, 503, `"code":"unavailable"`},
		{"без page_context", `{"text":"привет"}`, true, 503, `"code":"unavailable"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			api, token := testAPI()
			rec := doRequest(api, token, "POST", "/api/v1/chat/messages", tt.body, tt.auth)
			require.Equal(t, tt.wantStatus, rec.Code)
			require.Contains(t, rec.Body.String(), tt.wantBody)
		})
	}
}
