package worktools

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"maps"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

type Summary struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Area     string `json:"area"`
	ReadTool string `json:"read_tool"`
}

var recordID = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

func (c *Catalog) Available(team string) []Summary {
	out := []Summary{}
	for _, id := range slices.Sorted(maps.Keys(c.services)) {
		page := c.services[id]
		if slices.ContainsFunc(page.Records, func(r Record) bool { return r.Team == team }) {
			out = append(out, Summary{ID: id, Name: page.Name, Area: page.Area, ReadTool: "get_work_tool_context"})
		}
	}
	return out
}
func (c *Catalog) CatalogData(team string, jira, confluence bool) map[string]any {
	tools := c.Available(team)
	if jira {
		tools = append(tools, Summary{ID: "jira", Name: "Jira", Area: "Задачи", ReadTool: "get_service_context"})
	}
	if confluence {
		tools = append(tools, Summary{ID: "confluence", Name: "Confluence", Area: "Документация", ReadTool: "search_knowledge"})
	}
	return map[string]any{"tools": tools, "references": []any{workSource("work-tools:"+team, "Мои рабочие инструменты", "/tools")}}
}
func workSource(id, title, address string) map[string]any {
	title, _ = clipped(title, 200)
	if len(id) > 128 {
		hash := sha256.Sum256([]byte(id))
		id = "work:" + hex.EncodeToString(hash[:16])
	}
	return map[string]any{"id": id, "title": title, "url": address, "version": "live-v1", "is_demo": true}
}
func clipped(value string, limit int) (string, bool) {
	chars := []rune(value)
	if len(chars) > limit {
		return string(chars[:limit]), true
	}
	return value, false
}
func (c *Catalog) AgentContext(ctx context.Context, team string, args map[string]any) (map[string]any, error) {
	for key := range args {
		if key != "service" && key != "record_id" {
			return nil, buddy.ErrInvalidInput
		}
	}
	service, ok := args["service"].(string)
	if !ok {
		return nil, buddy.ErrInvalidInput
	}
	selected := ""
	if raw := args["record_id"]; raw != nil {
		var valid bool
		selected, valid = raw.(string)
		if !valid || !recordID.MatchString(selected) {
			return nil, buddy.ErrInvalidInput
		}
	}
	page, err := c.Read(ctx, team, service)
	if err != nil {
		return nil, err
	}
	records := []any{}
	references := []any{}
	more := false
	for _, record := range page.Records {
		if record.Team != team || !recordID.MatchString(record.ID) || strings.TrimSpace(record.Title) == "" {
			return nil, buddy.ErrUnavailable
		}
		if selected != "" && record.ID != selected {
			continue
		}
		if len(records) == 5 {
			more = true
			continue
		}
		title, t1 := clipped(record.Title, 200)
		status, t2 := clipped(record.Status, 200)
		description, t3 := clipped(record.Description, 2000)
		truncated := t1 || t2 || t3
		fields := map[string]string{}
		for _, key := range slices.Sorted(maps.Keys(record.Fields)) {
			if len(fields) == 24 {
				truncated = true
				break
			}
			if len(key) > 128 {
				return nil, buddy.ErrUnavailable
			}
			value, cut := clipped(record.Fields[key], 2000)
			fields[key] = value
			truncated = truncated || cut
		}
		records = append(records, map[string]any{"id": record.ID, "title": title, "status": status, "description": description, "fields": fields, "truncated": truncated})
		references = append(references, workSource(service+":"+record.ID, page.Name+" · "+title, c.publicURL+"/work-tools/"+service+"#"+url.PathEscape(record.ID)))
	}
	if selected != "" && len(records) == 0 {
		return nil, buddy.ErrNotFound
	}
	if len(references) == 0 {
		references = append(references, workSource("work-tools:"+service, page.Name, c.publicURL+"/work-tools/"+service))
	}
	out := map[string]any{"service": service, "name": page.Name, "area": page.Area, "records": records, "has_more": more, "references": references}
	for {
		raw, err := json.Marshal(out)
		if err != nil {
			return nil, buddy.ErrUnavailable
		}
		if len(raw) <= 12*1024 {
			return out, nil
		}
		if len(records) <= 1 {
			return nil, buddy.ErrUnavailable
		}
		records = records[:len(records)-1]
		references = references[:len(records)]
		out["records"] = records
		out["references"] = references
		out["has_more"] = true
	}
}
