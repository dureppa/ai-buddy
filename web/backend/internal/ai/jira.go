package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func wantsJira(query string) bool {
	query = strings.ToLower(query)
	return strings.Contains(query, "jira") || strings.Contains(query, "джир") ||
		strings.Contains(query, "мою задачу") || strings.Contains(query, "мои задачи") ||
		strings.Contains(query, "тикет") || strings.Contains(query, "у меня задача")
}

func (b *Bridge) jiraDocuments(ctx context.Context, profile string, limit int) ([]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	payload, err := json.Marshal(map[string]string{"profile_id": profile})
	if err != nil {
		return nil, err
	}
	login, err := http.NewRequestWithContext(ctx, http.MethodPost, b.JiraURL+"/api/v1/demo/sessions", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	login.Header.Set("Content-Type", "application/json")
	var session struct {
		Token   string `json:"access_token"`
		Profile string `json:"profile_id"`
	}
	if err := b.readJira(login, &session); err != nil || session.Profile != profile || session.Token == "" {
		return nil, fmt.Errorf("jira session unavailable")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, b.JiraURL+"/api/v1/me/issues", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+session.Token)
	var issues []struct {
		ID, Key, Title, Description, Status string
		Board                               string `json:"board_id"`
		Space                               string `json:"space_id"`
		Due                                 string `json:"due_date"`
	}
	if err := b.readJira(request, &issues); err != nil {
		return nil, err
	}
	docs := []any{}
	for _, issue := range issues[:min(len(issues), limit)] {
		params := url.Values{"profile": {profile}, "space": {issue.Space}, "board": {issue.Board}, "issue": {issue.ID}}
		excerpt := []rune("Статус: " + issue.Status + ". Срок: " + issue.Due + ". " + issue.Description)
		title := []rune(issue.Key + " · " + issue.Title)
		docs = append(docs, map[string]any{
			"source": map[string]any{"id": "jira:" + issue.ID, "version": "1", "is_demo": true,
				"title": string(title[:min(200, len(title))]), "url": b.PublicJiraURL + "/?" + params.Encode()},
			"excerpt": string(excerpt[:min(1200, len(excerpt))]),
		})
	}
	return docs, nil
}

func (b *Bridge) readJira(req *http.Request, dst any) error {
	res, err := b.Client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("jira HTTP %d", res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 256<<10)).Decode(dst)
}
