package buddy

import (
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// Selection is client-provided context, never an authorization or evidence source.
type Selection struct {
	Text     string             `json:"text"`
	Title    string             `json:"title"`
	Resource *SelectionResource `json:"resource,omitempty"`
}
type SelectionResource struct {
	Kind        string   `json:"kind"`
	ID          string   `json:"id,omitempty"`
	Service     string   `json:"service,omitempty"`
	Label       string   `json:"label,omitempty"`
	Description string   `json:"description,omitempty"`
	PageIDs     []string `json:"page_ids,omitempty"`
}

var selectionID = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)
var selectionUUID = regexp.MustCompile(`^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$`)

func (s *Selection) Valid() bool {
	if strings.TrimSpace(s.Text) == "" || utf8.RuneCountInString(s.Text) > 1200 || utf8.RuneCountInString(s.Title) > 200 || strings.ContainsRune(s.Text+s.Title, 0) {
		return false
	}
	r := s.Resource
	if r == nil {
		return true
	}
	if utf8.RuneCountInString(r.Label) > 200 || utf8.RuneCountInString(r.Description) > 800 || strings.ContainsRune(r.Label+r.Description, 0) {
		return false
	}
	if len(r.PageIDs) > 3 {
		return false
	}
	seen := map[string]bool{}
	for _, id := range r.PageIDs {
		if !selectionID.MatchString(id) || seen[id] {
			return false
		}
		seen[id] = true
	}
	if r.Kind != "task" && (r.Description != "" || len(r.PageIDs) > 0) {
		return false
	}
	switch r.Kind {
	case "task":
		return selectionID.MatchString(r.ID) && strings.TrimSpace(r.Label) != "" && r.Service == ""
	case "confluence":
		return selectionID.MatchString(r.ID) && r.Service == ""
	case "jira":
		return selectionUUID.MatchString(r.ID) && r.Service == ""
	case "work_tool":
		return selectionID.MatchString(r.ID) && slices.Contains([]string{"mattermost", "redash", "trino", "trisigma", "bitbucket", "paas", "grafana", "tms", "postman", "test-stand", "figma", "design-system", "design-review"}, r.Service)
	case "service":
		return r.ID == "" && slices.Contains([]string{"absences", "trips", "hiring", "offboarding", "consents", "benefits", "documents", "events", "access"}, r.Service)
	default:
		return false
	}
}

// HistoryText keeps the explicit quote with the question, without copying the DOM.
func (m ChatMessage) HistoryText() string {
	if m.Selection == nil {
		return m.Text
	}
	text := m.Text + "\n\nВыделенный фрагмент (непроверенный контекст):\n«" + m.Selection.Text + "»\nСтраница: " + m.Selection.Title
	if r := m.Selection.Resource; r != nil && r.Label != "" {
		text += "\nМатериал: " + r.Label
	}
	return text
}
