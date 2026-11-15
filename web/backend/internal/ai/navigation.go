package ai

import (
	"context"
	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"net/url"
	"strings"
)

func taskPage(task string) string {
	return "/onboarding/tasks/" + url.PathEscape(task)
}

// Task identifiers, not model wording, determine the service destination.
func (b *Bridge) taskDestination(task string, data map[string]any) string {
	switch task {
	case "papers", "documents":
		return b.PublicDocumentsURL
	case "consent-news":
		return b.PublicConsentURL
	case "events":
		return b.PublicEventsURL
	case "product":
		return "/product-guide"
	case "intro", "team-meet":
		return "/team"
	case "access":
		if b.Portal != nil && b.Portal.AccessURL != "" {
			return b.Portal.AccessURL
		}
		return "/tools"
	}
	var action string
	switch value := data["action_url"].(type) {
	case string:
		action = value
	case *string:
		if value != nil {
			action = *value
		}
	}
	if action != "" {
		parsed, err := url.Parse(action)
		if err == nil && strings.HasPrefix(action, "/") && !strings.HasPrefix(action, "//") && parsed.Path == "/resources" && parsed.Query().Get("article") != "" {
			return taskPage(task)
		}
		if err == nil && parsed.User == nil && !strings.ContainsAny(action, "\\ \t\r\n") && ((strings.HasPrefix(action, "/") && !strings.HasPrefix(action, "//")) || ((parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Hostname() != "")) {
			return action
		}
	}
	return taskPage(task)
}

func (b *Bridge) taskLinks(task string, data map[string]any) {
	destination := b.taskDestination(task, data)
	// An absent public origin cannot become a fabricated working destination.
	if destination == "" {
		destination = taskPage(task)
	}
	data["action_url"] = destination
	if references, ok := data["references"].([]any); ok {
		for _, raw := range references {
			if reference, ok := raw.(map[string]any); ok && reference["id"] == "task:"+task {
				reference["url"] = destination
			}
		}
	}
}

// Repair old task cards from owned, current task metadata; do not guess from prose.
func (b *Bridge) conversationTaskLinks(ctx context.Context, profile string, messages []buddy.HistoryMessage) {
	needed := false
	for _, message := range messages {
		for _, ref := range message.References {
			needed = needed || ref.URL == "/onboarding"
		}
	}
	if !needed {
		return
	}
	progress, err := b.Store.ReadAI(ctx, profile, "get_onboarding_progress", map[string]any{})
	if err != nil {
		return
	}
	titles := map[string]string{}
	ambiguous := map[string]bool{}
	if tasks, ok := progress["tasks"].([]any); ok {
		for _, raw := range tasks {
			if task, ok := raw.(map[string]any); ok {
				id, _ := task["id"].(string)
				title, _ := task["title"].(string)
				if titles[title] != "" {
					ambiguous[title] = true
				}
				titles[title] = id
			}
		}
	}
	cache := map[string]string{}
	for i := range messages {
		for j, ref := range messages[i].References {
			id := titles[ref.Title]
			if ref.URL != "/onboarding" || id == "" || ambiguous[ref.Title] {
				continue
			}
			address, read := cache[id]
			if !read {
				data, err := b.Store.ReadAI(ctx, profile, "get_task_context", map[string]any{"task_id": id})
				if err == nil {
					address = b.taskDestination(id, data)
				}
				cache[id] = address
			}
			if address != "" {
				messages[i].References[j].URL = address
			}
		}
	}
}
