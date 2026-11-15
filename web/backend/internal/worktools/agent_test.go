package worktools

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/stretchr/testify/require"
)
func testCatalog(t *testing.T) *Catalog {
	t.Helper()
	c, err := NewExternal("https://tools.example.com", "test-work-tool-secret-32-characters")
	require.NoError(t, err)
	c.external.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		name := strings.TrimPrefix(r.URL.Path, "/api/v1/work-tools/")
		meta := c.services[name]
		team := ""
		for _, row := range meta.Records {
			team = row.Team
			break
		}
		rows := []Record{}
		for _, row := range meta.Records {
			if row.Team == team {
				rows = append(rows, row)
			}
		}
		raw, _ := json.Marshal(Page{Name: meta.Name, Area: meta.Area, Records: rows})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
	})
	return c
}
func TestAgentCatalogByDirection(t *testing.T) {
	c := testCatalog(t)
	cases := map[string][]string{"delivery": {"mattermost", "redash", "trino", "trisigma"}, "travel": {"mattermost", "bitbucket", "paas", "grafana"}, "autoteca": {"mattermost", "tms", "postman", "test-stand"}, "help": {"mattermost", "figma", "design-system", "design-review"}}
	for team, want := range cases {
		t.Run(team, func(t *testing.T) {
			items := c.Available(team)
			ids := []string{}
			for _, item := range items {
				ids = append(ids, item.ID)
				require.Equal(t, "get_work_tool_context", item.ReadTool)
			}
			require.ElementsMatch(t, want, ids)
			data := c.CatalogData(team, true, true)
			require.Len(t, data["tools"], 6)
			require.Len(t, data["references"], 1)
		})
	}
	require.Empty(t, c.Available("unknown"))
}
func TestAllWorkContextsAndSelectedRecord(t *testing.T) {
	c := testCatalog(t)
	for name, meta := range c.services {
		t.Run(name, func(t *testing.T) {
			team := meta.Records[0].Team
			out, err := c.AgentContext(context.Background(), team, map[string]any{"service": name})
			require.NoError(t, err)
			rows := out["records"].([]any)
			require.NotEmpty(t, rows)
			require.Equal(t, name, out["service"])
			for _, v := range rows {
				require.NotContains(t, v.(map[string]any), "team")
			}
			id := rows[0].(map[string]any)["id"].(string)
			one, err := c.AgentContext(context.Background(), team, map[string]any{"service": name, "record_id": id})
			require.NoError(t, err)
			require.Len(t, one["records"], 1)
			refs := one["references"].([]any)
			require.Contains(t, refs[0].(map[string]any)["url"], "/work-tools/"+name+"#"+id)
			_, err = c.AgentContext(context.Background(), team, map[string]any{"service": name, "record_id": "missing"})
			require.ErrorIs(t, err, buddy.ErrNotFound)
		})
	}
}
func TestWorkContextAccessAndInput(t *testing.T) {
	c := testCatalog(t)
	for _, args := range []map[string]any{{"service": "redash", "profile_id": "sasha"}, {"service": "redash", "url": "http://evil.example"}, {"service": true}, {"service": "redash", "record_id": "../secret"}, {"service": "redash", "record_id": 2}} {
		_, err := c.AgentContext(context.Background(), "delivery", args)
		require.ErrorIs(t, err, buddy.ErrInvalidInput)
	}
	_, err := c.AgentContext(context.Background(), "travel", map[string]any{"service": "redash"})
	require.ErrorIs(t, err, buddy.ErrNotFound)
	_, err = c.AgentContext(context.Background(), "delivery", map[string]any{"service": "missing"})
	require.ErrorIs(t, err, buddy.ErrNotFound)
}
func TestWorkContextBudget(t *testing.T) {
	c := testCatalog(t)
	c.external.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		rows := []Record{}
		for i := range 10 {
			fields := map[string]string{}
			for j := range 30 {
				fields[string(rune('a'+j))] = strings.Repeat("x", 3000)
			}
			rows = append(rows, Record{Team: "delivery", ID: "r" + string(rune('a'+i)), Title: strings.Repeat("t", 300), Description: strings.Repeat("d", 3000), Fields: fields})
		}
		raw, _ := json.Marshal(Page{Records: rows})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
	})
	_, err := c.AgentContext(context.Background(), "delivery", map[string]any{"service": "redash"})
	require.ErrorIs(t, err, buddy.ErrUnavailable)
	c.external.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		rows := []Record{}
		for i := range 10 {
			rows = append(rows, Record{Team: "delivery", ID: "r" + string(rune('a'+i)), Title: "title", Description: strings.Repeat("d", 3000), Fields: map[string]string{}})
		}
		raw, _ := json.Marshal(Page{Records: rows})
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
	})
	out, err := c.AgentContext(context.Background(), "delivery", map[string]any{"service": "redash"})
	require.NoError(t, err)
	require.Equal(t, true, out["has_more"])
	require.Len(t, out["records"], 5)
	raw, _ := json.Marshal(out)
	require.Less(t, len(raw), 12*1024)
	require.Equal(t, true, out["records"].([]any)[0].(map[string]any)["truncated"])
}
func TestExternalWorkFailureBoundaries(t *testing.T) {
	for _, kind := range []string{"foreign-team", "bad-json", "trailing", "oversize", "not-found", "forbidden", "redirect", "network"} {
		t.Run(kind, func(t *testing.T) {
			c := testCatalog(t)
			c.external.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
				body, status := `{"records":[{"team":"travel","id":"x","title":"Secret"}]}`, 200
				switch kind {
				case "bad-json":
					body = "{"
				case "trailing":
					body = `{"records":[]} {}`
				case "oversize":
					body = strings.Repeat(" ", 2<<20+1)
				case "not-found":
					status = 404
				case "forbidden":
					status = 403
				case "redirect":
					status = 307
				case "network":
					return nil, errors.New("network")
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{"Location": []string{"https://evil.example"}}}, nil
			})
			_, err := c.AgentContext(context.Background(), "delivery", map[string]any{"service": "redash"})
			require.Error(t, err)
		})
	}
}
