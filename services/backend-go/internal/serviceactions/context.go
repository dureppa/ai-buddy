package serviceactions

import (
	"context"
	"encoding/json"
	"net/url"
)

func (s *Service) Context(ctx context.Context, profile string, args map[string]any) (map[string]any, error) {
	raw, _ := json.Marshal(args)
	var in contextArgs
	if strict(raw, &in) != nil || in.Service == "" || (in.Service != "jira" && (in.BoardID != nil || in.IssueID != nil)) || (in.BoardID != nil && in.IssueID != nil) {
		return nil, ErrInvalid
	}
	e, err := s.endpoint(in.Service)
	if err != nil {
		return nil, err
	}
	if in.Service == "jira" {
		return s.jiraContext(ctx, profile, in, e)
	}
	path := map[string]string{"hiring": "/api/v1/me/referral-summary", "offboarding": "/api/v1/me/offboarding", "benefits": "/api/v1/me/benefit-summary"}[in.Service]
	var data map[string]any
	if err = s.get(ctx, in.Service, profile, path, &data); err != nil {
		return nil, err
	}
	var out map[string]any
	title := ""
	switch in.Service {
	case "hiring":
		out = projection(data, "referral_slots", "referral_left", "vacancies", "referrals")
		title = "Найм: мои рекомендации"
		rows, err := array(out, "referrals")
		if err != nil {
			return nil, err
		}
		out["has_more"] = len(rows) > 30
		if len(rows) > 30 {
			out["referrals"] = rows[:30]
		}
	case "offboarding":
		out = projection(data, "exit_notice_days", "earliest_exit", "steps", "checklist", "draft")
		title = "Мой план завершения работы"
	case "benefits":
		out = projection(data, "benefit_budget", "benefit_left", "options", "requests")
		title = "Мои бенефиты"
		rows, err := array(out, "requests")
		if err != nil {
			return nil, err
		}
		out["has_more"] = len(rows) > 30
		if len(rows) > 30 {
			out["requests"] = rows[:30]
		}
	}
	out["service"] = in.Service
	out["references"] = []any{source(in.Service, title, e.PublicURL)}
	return out, nil
}
func (s *Service) jiraContext(ctx context.Context, profile string, in contextArgs, e Endpoint) (map[string]any, error) {
	out := map[string]any{"service": "jira", "current_user_id": profile, "spaces": []any{}, "boards": []any{}, "issues": []any{}, "members": []any{}, "has_more": false}
	address := e.PublicURL
	if in.IssueID != nil {
		if !validUUID(*in.IssueID) {
			return nil, ErrInvalid
		}
		var issue map[string]any
		if err := s.get(ctx, "jira", profile, "/api/v1/issues/"+url.PathEscape(*in.IssueID), &issue); err != nil {
			return nil, err
		}
		out["issues"] = []any{jiraIssue(issue)}
		address = jiraURL(address, stringValue(issue, "space_id"), stringValue(issue, "board_id"), *in.IssueID)
	} else if in.BoardID != nil {
		if !validID(*in.BoardID) {
			return nil, ErrInvalid
		}
		var board map[string]any
		if err := s.get(ctx, "jira", profile, "/api/v1/boards/"+url.PathEscape(*in.BoardID), &board); err != nil {
			return nil, err
		}
		issues, err := array(board, "issues")
		if err != nil {
			return nil, err
		}
		if len(issues) > 20 {
			issues = issues[:20]
			out["has_more"] = true
		}
		rows := []any{}
		for _, v := range issues {
			m, ok := v.(map[string]any)
			if !ok {
				return nil, ErrUnavailable
			}
			rows = append(rows, jiraIssue(m))
		}
		out["issues"] = rows
		out["boards"] = []any{projection(board, "id", "name", "space_id", "key")}
		out["members"] = board["members"]
		address = jiraURL(address, stringValue(board, "space_id"), *in.BoardID, "")
	} else {
		var spaces []map[string]any
		if err := s.get(ctx, "jira", profile, "/api/v1/spaces", &spaces); err != nil {
			return nil, err
		}
		if spaces == nil {
			return nil, ErrUnavailable
		}
		if len(spaces) > 20 {
			spaces = spaces[:20]
			out["has_more"] = true
		}
		visibleSpaces := []any{}
		boards := []any{}
		for _, space := range spaces {
			id := stringValue(space, "id")
			if !validID(id) {
				return nil, ErrUnavailable
			}
			visibleSpaces = append(visibleSpaces, projection(space, "id", "name"))
			var rows []map[string]any
			if err := s.get(ctx, "jira", profile, "/api/v1/spaces/"+url.PathEscape(id)+"/boards", &rows); err != nil {
				return nil, err
			}
			if rows == nil {
				return nil, ErrUnavailable
			}
			for _, board := range rows {
				if len(boards) < 30 {
					boards = append(boards, projection(board, "id", "name", "space_id", "key"))
				} else {
					out["has_more"] = true
				}
			}
		}
		var issues []map[string]any
		if err := s.get(ctx, "jira", profile, "/api/v1/me/issues", &issues); err != nil {
			return nil, err
		}
		if issues == nil {
			return nil, ErrUnavailable
		}
		if len(issues) > 20 {
			issues = issues[:20]
			out["has_more"] = true
		}
		rows := []any{}
		for _, issue := range issues {
			rows = append(rows, jiraIssue(issue))
		}
		out["spaces"] = visibleSpaces
		out["boards"] = boards
		out["issues"] = rows
	}
	out["references"] = []any{source("jira", "Мои задачи Jira", address)}
	return out, nil
}
func jiraIssue(raw map[string]any) map[string]any {
	out := projection(raw, "id", "board_id", "space_id", "key", "title", "description", "status", "priority", "assignee_id", "reporter_id", "due_date", "version")
	description := []rune(stringValue(raw, "description"))
	out["description_truncated"] = len(description) > 2000
	if len(description) > 2000 {
		out["description"] = string(description[:2000])
	}
	return out
}
func jiraURL(base, space, board, issue string) string {
	u, err := url.Parse(base)
	if err != nil {
		return base
	}
	q := u.Query()
	if space != "" {
		q.Set("space", space)
	}
	if board != "" {
		q.Set("board", board)
	}
	if issue != "" {
		q.Set("issue", issue)
	}
	u.RawQuery = q.Encode()
	return u.String()
}
