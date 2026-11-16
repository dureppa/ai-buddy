package serviceactions

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var identifier = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)
var uuidPattern = regexp.MustCompile(`^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$`)

func validID(s string) bool   { return identifier.MatchString(s) }
func validUUID(s string) bool { return uuidPattern.MatchString(s) }
func strict(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return ErrInvalid
	}
	return nil
}
func integer(v any) (int, bool) {
	n, ok := v.(float64)
	return int(n), ok && n >= 0 && n <= 2147483647 && math.Trunc(n) == n
}
func number(m map[string]any, k string) (int, error) {
	v, ok := integer(m[k])
	if !ok {
		return 0, ErrUnavailable
	}
	return v, nil
}
func text(v any, min, max int) (string, bool) {
	s, ok := v.(string)
	s = strings.TrimSpace(s)
	return s, ok && utf8.RuneCountInString(s) >= min && utf8.RuneCountInString(s) <= max && !strings.ContainsRune(s, 0)
}
func known(rows []any, id string) (map[string]any, bool) {
	for _, raw := range rows {
		row, ok := raw.(map[string]any)
		if ok && stringValue(row, "id") == id {
			return row, true
		}
	}
	return nil, false
}
func operationService(op string) string {
	switch op {
	case "request_access":
		return "access"
	case "create_calendar_event":
		return "calendar"
	case "refer_candidate":
		return "hiring"
	case "set_exit_step", "save_exit_draft":
		return "offboarding"
	case "request_benefit":
		return "benefits"
	case "create_jira_issue", "update_jira_issue":
		return "jira"
	}
	return ""
}
func normalize(action map[string]any) (string, map[string]any, error) {
	op := stringValue(action, "operation")
	allowed := map[string][]string{
		"create_calendar_event": {"title", "kind", "starts_at", "description"},
		"request_access":        {"template_id", "catalog_version", "system", "resource_key", "justification", "permission", "duration_days", "fields"},
		"refer_candidate":       {"vacancy", "name", "email"}, "set_exit_step": {"step", "checked"}, "save_exit_draft": {"date"}, "request_benefit": {"benefit"},
		"create_jira_issue": {"board_id", "title", "description", "status", "priority", "assignee_id", "due_date"}, "update_jira_issue": {"issue_id", "version", "changes"},
	}[op]
	if allowed == nil {
		return "", nil, ErrInvalid
	}
	keys := map[string]bool{"operation": true}
	for _, k := range allowed {
		keys[k] = true
	}
	for k := range action {
		if !keys[k] {
			return "", nil, ErrInvalid
		}
	}
	p := map[string]any{}
	for k, v := range action {
		if k != "operation" {
			p[k] = v
		}
	}
	switch op {
	case "create_calendar_event":
		if _, ok := p["kind"]; !ok {
			p["kind"] = "Встреча"
		}
		if _, ok := p["description"]; !ok {
			p["description"] = ""
		}
		if _, err := calendarEvent("pending", p); err != nil {
			return "", nil, err
		}
	case "refer_candidate":
		vacancy, ok := text(p["vacancy"], 1, 128)
		if !ok || !validID(vacancy) {
			return "", nil, ErrInvalid
		}
		name, ok := text(p["name"], 2, 100)
		if !ok {
			return "", nil, ErrInvalid
		}
		email, ok := text(p["email"], 3, 200)
		if !ok {
			return "", nil, ErrInvalid
		}
		email = strings.ToLower(email)
		parsed, err := mail.ParseAddress(email)
		if err != nil || parsed.Address != email || !strings.Contains(email, ".") {
			return "", nil, ErrInvalid
		}
		p = map[string]any{"vacancy": vacancy, "name": name, "email": email}
	case "set_exit_step":
		id, ok := text(p["step"], 1, 128)
		_, valid := p["checked"].(bool)
		if !ok || !validID(id) || !valid {
			return "", nil, ErrInvalid
		}
		p["step"] = id
	case "save_exit_draft":
		date, ok := p["date"].(string)
		if !ok {
			return "", nil, ErrInvalid
		}
		if _, err := time.Parse(time.DateOnly, date); err != nil {
			return "", nil, ErrInvalid
		}
	case "request_benefit":
		id, ok := text(p["benefit"], 1, 128)
		if !ok || !validID(id) {
			return "", nil, ErrInvalid
		}
		p["benefit"] = id
	case "create_jira_issue":
		if !validID(stringValue(p, "board_id")) {
			return "", nil, ErrInvalid
		}
		defaults := map[string]any{"description": "", "status": "todo", "priority": "medium", "assignee_id": nil, "due_date": nil}
		for k, v := range defaults {
			if _, ok := p[k]; !ok {
				p[k] = v
			}
		}
		if !validJiraFields(p, false) {
			return "", nil, ErrInvalid
		}
	case "update_jira_issue":
		version, ok := integer(p["version"])
		changes, valid := p["changes"].(map[string]any)
		if !validUUID(stringValue(p, "issue_id")) || !ok || version < 1 || !valid || len(changes) == 0 || !validJiraFields(changes, true) {
			return "", nil, ErrInvalid
		}
	}
	return op, p, nil
}
func validJiraFields(p map[string]any, patch bool) bool {
	for k, v := range p {
		switch k {
		case "board_id":
			if patch {
				return false
			}
		case "title":
			s, ok := text(v, 1, 200)
			if !ok {
				return false
			}
			p[k] = s
		case "description":
			s, ok := v.(string)
			if !ok || utf8.RuneCountInString(s) > 4000 || strings.ContainsRune(s, 0) {
				return false
			}
		case "status":
			if v != "todo" && v != "in_progress" && v != "review" && v != "done" {
				return false
			}
		case "priority":
			if v != "low" && v != "medium" && v != "high" {
				return false
			}
		case "assignee_id":
			if v != nil {
				s, ok := v.(string)
				if !ok || !validID(s) {
					return false
				}
			}
		case "due_date":
			if v != nil {
				s, ok := v.(string)
				if !ok {
					return false
				}
				if _, err := time.Parse(time.DateOnly, s); err != nil {
					return false
				}
			}
		default:
			return false
		}
	}
	if !patch {
		if _, ok := p["title"]; !ok {
			return false
		}
	}
	return true
}
func (s *Service) Prepare(ctx context.Context, profile, requestID string, args map[string]any) (map[string]any, error) {
	if len(args) != 1 {
		return nil, ErrInvalid
	}
	action, ok := args["action"].(map[string]any)
	if !ok {
		return nil, ErrInvalid
	}
	op, p, err := normalize(action)
	if err != nil {
		return nil, err
	}
	d, err := s.plan(ctx, profile, op, p)
	if err != nil {
		return nil, err
	}
	d.Profile = profile
	d.RequestID = requestID
	d.Operation = op
	d.Service = operationService(op)
	d.Payload, _ = json.Marshal(p)
	hash := sha256.Sum256(append([]byte(op+":"), d.Payload...))
	d.Fingerprint = hex.EncodeToString(hash[:])
	d, err = s.Store.Save(ctx, d)
	if err != nil {
		return nil, err
	}
	d = publicDraft(d)
	address := "/actions/" + d.ID
	return map[string]any{"draft": d, "references": []any{map[string]any{"id": "action:" + d.ID, "title": "Проверить действие: " + d.Title, "url": address, "version": "draft-v1", "is_demo": true}}}, nil
}
func (s *Service) plan(ctx context.Context, profile, op string, p map[string]any) (Draft, error) {
	if op == "create_calendar_event" {
		return s.planCalendar(p)
	}
	if op == "request_access" {
		return s.planAccess(ctx, profile, p)
	}
	service := operationService(op)
	e, err := s.endpoint(service)
	if err != nil {
		return Draft{}, err
	}
	d := Draft{ServiceURL: e.PublicURL, Fields: []Field{}}
	field := func(label, value string) { d.Fields = append(d.Fields, Field{label, value}) }
	if service == "jira" {
		return s.planJira(ctx, profile, op, p, d)
	}
	data, err := s.Context(ctx, profile, map[string]any{"service": service})
	if err != nil {
		return d, err
	}
	switch op {
	case "refer_candidate":
		rows, err := array(data, "vacancies")
		if err != nil {
			return d, err
		}
		vacancy, ok := known(rows, stringValue(p, "vacancy"))
		if !ok {
			return d, ErrNotFound
		}
		left, err := number(data, "referral_left")
		if err != nil {
			return d, err
		}
		if left < 1 {
			return d, ErrConflict
		}
		referrals, err := array(data, "referrals")
		if err != nil {
			return d, err
		}
		for _, v := range referrals {
			row, ok := v.(map[string]any)
			if !ok {
				return d, ErrUnavailable
			}
			if row["vacancy"] == p["vacancy"] && strings.EqualFold(stringValue(row, "email"), stringValue(p, "email")) {
				return d, ErrConflict
			}
		}
		d.Title = "Рекомендовать кандидата"
		field("Вакансия", stringValue(vacancy, "title"))
		field("Кандидат", stringValue(p, "name"))
		field("Почта", stringValue(p, "email"))
	case "set_exit_step":
		rows, err := array(data, "steps")
		if err != nil {
			return d, err
		}
		step, ok := known(rows, stringValue(p, "step"))
		if !ok {
			return d, ErrNotFound
		}
		d.Title = "Изменить отметку шага"
		field("Шаг", stringValue(step, "title"))
		if p["checked"] == true {
			field("Отметка", "Выполнен")
		} else {
			field("Отметка", "Не выполнен")
		}
	case "save_exit_draft":
		if stringValue(p, "date") < stringValue(data, "earliest_exit") || stringValue(data, "earliest_exit") == "" {
			return d, ErrInvalid
		}
		if data["draft"] != nil {
			return d, ErrConflict
		}
		rows, err := array(data, "steps")
		if err != nil {
			return d, err
		}
		checks, err := array(data, "checklist")
		if err != nil {
			return d, err
		}
		if len(rows) != len(checks) {
			return d, ErrConflict
		}
		d.Title = "Сохранить учебный черновик завершения работы"
		field("Последний день", stringValue(p, "date"))
	case "request_benefit":
		rows, err := array(data, "options")
		if err != nil {
			return d, err
		}
		option, ok := known(rows, stringValue(p, "benefit"))
		if !ok || option["available"] != true {
			return d, ErrNotFound
		}
		amount, err := number(option, "amount")
		if err != nil {
			return d, err
		}
		left, err := number(data, "benefit_left")
		if err != nil {
			return d, err
		}
		if left < amount {
			return d, ErrConflict
		}
		if expected, exists := p["expected_amount"]; exists {
			value, ok := integer(expected)
			if !ok || value != amount {
				return d, ErrConflict
			}
		}
		p["expected_amount"] = float64(amount)
		requests, err := array(data, "requests")
		if err != nil {
			return d, err
		}
		for _, v := range requests {
			row, ok := v.(map[string]any)
			if !ok {
				return d, ErrUnavailable
			}
			if row["benefit"] == p["benefit"] {
				return d, ErrConflict
			}
		}
		d.Title = "Подать заявку на бенефит"
		field("Программа", stringValue(option, "title"))
		field("Сумма", fmt.Sprintf("%d ₽", amount))
	default:
		return d, ErrInvalid
	}
	return d, nil
}
func (s *Service) planJira(ctx context.Context, profile, op string, p map[string]any, d Draft) (Draft, error) {
	var boardID string
	var issue map[string]any
	if op == "update_jira_issue" {
		if err := s.get(ctx, "jira", profile, "/api/v1/issues/"+url.PathEscape(stringValue(p, "issue_id")), &issue); err != nil {
			return d, err
		}
		if issue["version"] != p["version"] {
			return d, ErrConflict
		}
		boardID = stringValue(issue, "board_id")
	} else {
		boardID = stringValue(p, "board_id")
	}
	var board map[string]any
	if err := s.get(ctx, "jira", profile, "/api/v1/boards/"+url.PathEscape(boardID), &board); err != nil {
		return d, err
	}
	members, err := array(board, "members")
	if err != nil {
		return d, err
	}
	values := p
	if op == "update_jira_issue" {
		var ok bool
		values, ok = p["changes"].(map[string]any)
		if !ok {
			return d, ErrInvalid
		}
	}
	labels := map[string]string{"title": "Название", "description": "Описание", "status": "Статус", "priority": "Приоритет", "assignee_id": "Исполнитель", "due_date": "Срок"}
	d.Title = "Создать задачу Jira"
	d.Fields = append(d.Fields, Field{"Доска", stringValue(board, "name")})
	if op == "update_jira_issue" {
		d.Title = "Изменить задачу Jira"
		d.Fields = append(d.Fields, Field{"Задача", stringValue(issue, "key") + " · " + stringValue(issue, "title")})
	}
	for _, key := range []string{"title", "description", "status", "priority", "assignee_id", "due_date"} {
		value, exists := values[key]
		if !exists {
			continue
		}
		shown := "Не задано"
		if value != nil {
			var ok bool
			shown, ok = value.(string)
			if !ok {
				return d, ErrInvalid
			}
		}
		if key == "assignee_id" && value != nil {
			member, ok := known(members, shown)
			if !ok {
				return d, ErrInvalid
			}
			shown = stringValue(member, "name")
		}
		if key == "status" {
			shown = map[string]string{"todo": "К выполнению", "in_progress": "В работе", "review": "На проверке", "done": "Готово"}[shown]
		}
		if key == "priority" {
			shown = map[string]string{"low": "Низкий", "medium": "Средний", "high": "Высокий"}[shown]
		}
		d.Fields = append(d.Fields, Field{labels[key], shown})
	}
	d.ServiceURL = jiraURL(d.ServiceURL, stringValue(board, "space_id"), boardID, stringValue(p, "issue_id"))
	return d, nil
}
