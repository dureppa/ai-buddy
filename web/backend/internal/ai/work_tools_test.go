package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/dureppa/ai-buddy/web/backend/internal/worktools"
	"github.com/stretchr/testify/require"
)

type workRepo struct{ *fakeRepo }

func (r *workRepo) ProfileByID(ctx context.Context, id string) (buddy.Profile, error) {
	p, err := r.fakeRepo.ProfileByID(ctx, id)
	p.TeamID = map[string]string{"olga": "delivery", "sasha": "travel", "timur": "autoteca", "maria": "help"}[id]
	return p, err
}
func TestWorkToolBridgeGrantsAndActor(t *testing.T) {
	b, repo := newBridge(t, "http://127.0.0.1:8001")
	b.Store = &workRepo{repo}
	catalog, err := worktools.NewExternal("https://tools.example", "test-delegation-secret-32-characters")
	require.NoError(t, err)
	b.WorkTools = catalog
	b.JiraURL = "http://jira:8189"
	mux := http.NewServeMux()
	b.Register(mux)
	for profile, own := range map[string]string{"olga": "redash", "sasha": "grafana", "timur": "postman", "maria": "figma"} {
		t.Run(profile, func(t *testing.T) {
			token, err := b.token(profile, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "mcp-delegation")
			require.NoError(t, err)
			resolved := call(mux, "POST", "/internal/v1/ai/context/resolve", b.AdapterToken, `{"delegation_token":"`+token+`"}`)
			require.Equal(t, 200, resolved.Code)
			var ctx struct {
				Tools []string `json:"allowed_tools"`
				Token string   `json:"api_token"`
			}
			require.NoError(t, json.Unmarshal(resolved.Body.Bytes(), &ctx))
			require.Contains(t, ctx.Tools, "get_work_tools")
			require.Contains(t, ctx.Tools, "get_work_tool_context")
			response := call(mux, "GET", "/internal/v1/ai/work-tools", ctx.Token, "")
			require.Equal(t, 200, response.Code)
			require.Contains(t, response.Body.String(), `"id":"`+own+`"`)
			for _, tool := range []string{"mattermost", "redash", "trino", "trisigma", "bitbucket", "paas", "grafana", "tms", "postman", "test-stand", "figma", "design-system", "design-review"} {
				require.Contains(t, response.Body.String(), `"id":"`+tool+`"`)
			}
			response = call(mux, "POST", "/internal/v1/ai/work-tools/context", ctx.Token, `{"service":"`+own+`","profile_id":"other"}`)
			require.Equal(t, 400, response.Code)
			response = call(mux, "POST", "/internal/v1/ai/work-tools/context", ctx.Token, `{"service":"unknown"}`)
			require.Equal(t, 404, response.Code)
			response = call(mux, "GET", "/internal/v1/ai/work-tools", token, "")
			require.Equal(t, 401, response.Code)
		})
	}
}
