package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

func source(id, title, url string) map[string]any {
	return map[string]any{"id": id, "title": title, "url": url, "version": "demo-v1", "is_demo": true}
}
func (s *Store) ReadAI(ctx context.Context, profile, tool string, args map[string]any) (map[string]any, error) {
	switch tool {
	case "search_knowledge":
		query, ok := args["query"].(string)
		limit, valid := args["limit"].(float64)
		if !ok || strings.TrimSpace(query) == "" || len([]rune(query)) > 500 || !valid || limit < 1 || limit > 5 || limit != float64(int(limit)) || len(args) != 2 {
			return nil, buddy.ErrInvalidInput
		}
		rows, err := s.q.Query(ctx, `WITH search AS (
            SELECT websearch_to_tsquery('russian', array_to_string(tsvector_to_array(to_tsvector('russian', $1)), ' OR ')) AS terms
        ), articles AS (
            SELECT *, setweight(to_tsvector('russian', title), 'A') || setweight(to_tsvector('russian', content), 'B') AS document
            FROM knowledge_articles
        )
        SELECT id,title,url,left(content,1200) FROM articles, search
        WHERE document @@ terms
        ORDER BY ts_rank(document, terms) DESC, id LIMIT $2`, buddy.KnowledgeSearchQuery(strings.TrimSpace(query)), int(limit))
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		docs := []any{}
		for rows.Next() {
			var id, title, url, excerpt string
			if err = rows.Scan(&id, &title, &url, &excerpt); err != nil {
				return nil, err
			}
			docs = append(docs, map[string]any{"source": source(id, title, url), "excerpt": excerpt})
		}
		return map[string]any{"documents": docs}, rows.Err()
	case "get_team_context":
		if len(args) != 0 {
			return nil, buddy.ErrInvalidInput
		}
		var id, name, summary, lead, leadContact string
		var mentor, mentorContact *string
		err := s.q.QueryRow(ctx, `SELECT t.id,t.name,t.product,t.lead_name,t.lead_contact,p.mentor_name,p.mentor_contact FROM profiles p JOIN teams t ON t.id=p.team_id WHERE p.id=$1`, profile).Scan(&id, &name, &summary, &lead, &leadContact, &mentor, &mentorContact)
		if err != nil {
			return nil, err
		}
		var m any
		if mentor != nil && mentorContact != nil {
			m = map[string]any{"display_name": *mentor, "contact": *mentorContact}
		}
		return map[string]any{"team": map[string]any{"id": id, "name": name, "summary": summary}, "mentor": m, "lead": map[string]any{"display_name": lead, "contact": leadContact}, "references": []any{source("team:"+id, "Команда "+name, "/team")}}, nil
	case "get_onboarding_progress":
		if len(args) != 0 {
			return nil, buddy.ErrInvalidInput
		}
		tasks, err := s.OnboardingTasks(ctx, profile)
		if err != nil {
			return nil, err
		}
		out := []any{}
		var next *string
		for _, t := range tasks {
			status := "pending"
			if t.Completed {
				status = "completed"
			} else if next == nil {
				id := t.ID
				next = &id
			}
			out = append(out, map[string]any{"id": t.ID, "title": t.Title, "status": status})
		}
		return map[string]any{"tasks": out, "next_task_id": next, "references": []any{source("onboarding:"+profile, "Личный чек-лист", "/onboarding")}}, nil
	case "get_task_context":
		task, ok := args["task_id"].(string)
		if !ok || len(args) != 1 {
			return nil, buddy.ErrInvalidInput
		}
		tasks, err := s.OnboardingTasks(ctx, profile)
		if err != nil {
			return nil, err
		}
		for _, t := range tasks {
			if t.ID == task {
				return map[string]any{"task_id": task, "title": t.Title, "guidance": t.Guidance, "action_url": t.ActionURL, "references": []any{source("task:"+task, t.Title, "/onboarding")}}, nil
			}
		}
		return nil, buddy.ErrNotFound
	default:
		return nil, fmt.Errorf("unsupported AI read")
	}
}
