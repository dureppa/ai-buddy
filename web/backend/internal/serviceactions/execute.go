package serviceactions

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"
)

func publicDraft(d Draft) Draft {
	if d.State == "prepared" && !d.ExpiresAt.After(time.Now()) {
		d.State = "expired"
	}
	if d.State == "executing" && d.StartedAt != nil && time.Since(*d.StartedAt) > 30*time.Second {
		d.State = "uncertain"
		d.Result = "Не удалось подтвердить результат. Проверь сервис; повторно действие не отправляется."
	}
	return d
}
func (s *Service) Get(ctx context.Context, profile, id string) (Draft, error) {
	if !validUUID(id) {
		return Draft{}, ErrNotFound
	}
	d, err := s.Store.Get(ctx, profile, id)
	return publicDraft(d), err
}
func (s *Service) Cancel(ctx context.Context, profile, id string) (Draft, error) {
	if !validUUID(id) {
		return Draft{}, ErrNotFound
	}
	d, err := s.Store.Cancel(ctx, profile, id)
	return publicDraft(d), err
}
func (s *Service) Confirm(ctx context.Context, profile, id string) (Draft, error) {
	if !validUUID(id) {
		return Draft{}, ErrNotFound
	}
	d, err := s.Store.Get(ctx, profile, id)
	if err != nil {
		return d, err
	}
	d = publicDraft(d)
	if d.State != "prepared" {
		return d, nil
	}
	var p map[string]any
	if json.Unmarshal(d.Payload, &p) != nil {
		return d, ErrUnavailable
	}
	if _, err = s.plan(ctx, profile, d.Operation, p); err != nil {
		// A concurrent confirmation may already have changed downstream eligibility.
		latest, readErr := s.Store.Get(ctx, profile, id)
		if readErr == nil && latest.State != "prepared" {
			return publicDraft(latest), nil
		}
		return d, err
	}
	claimed := false
	d, claimed, err = s.Store.Claim(ctx, profile, id)
	if err != nil || !claimed {
		return publicDraft(d), err
	}
	state, message := "succeeded", "Сервис подтвердил сохранение."
	if d.Operation == "request_access" {
		message, err = s.executeAccess(ctx, profile, d, p)
	} else if d.Operation == "create_calendar_event" {
		err = s.executeCalendar(ctx, profile, d, p)
		message = "Событие сохранено в календаре."
	} else {
		err = s.execute(ctx, profile, d, p)
	}
	if err != nil {
		state = "uncertain"
		message = "Не удалось подтвердить результат. Проверь сервис; повторно действие не отправляется."
		if errors.Is(err, ErrInvalid) || errors.Is(err, ErrConflict) || errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
			state = "failed"
			message = "Сервис отклонил действие. Обнови данные и подготовь новое подтверждение."
		}
	}
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	return s.Store.Finish(finishCtx, profile, id, state, message)
}
func (s *Service) execute(ctx context.Context, profile string, d Draft, p map[string]any) error {
	method, path, body := "POST", "", any(nil)
	switch d.Operation {
	case "refer_candidate":
		path = "/api/v1/me/referrals"
		body = projection(p, "vacancy", "name", "email")
	case "set_exit_step":
		method = "PUT"
		path = "/api/v1/me/offboarding/checklist/" + url.PathEscape(stringValue(p, "step"))
		body = projection(p, "checked")
	case "save_exit_draft":
		path = "/api/v1/me/offboarding/draft"
		body = projection(p, "date")
	case "request_benefit":
		path = "/api/v1/me/benefit-requests"
		body = projection(p, "benefit")
	case "create_jira_issue":
		path = "/api/v1/boards/" + url.PathEscape(stringValue(p, "board_id")) + "/issues"
		body = projection(p, "title", "description", "status", "priority", "assignee_id", "due_date")
	case "update_jira_issue":
		method = "PUT"
		path = "/api/v1/issues/" + url.PathEscape(stringValue(p, "issue_id"))
		var issue map[string]any
		if err := s.get(ctx, "jira", profile, path, &issue); err != nil {
			return err
		}
		if issue["version"] != p["version"] {
			return ErrConflict
		}
		merged := projection(issue, "title", "description", "status", "priority", "assignee_id", "due_date", "version")
		changes, ok := p["changes"].(map[string]any)
		if !ok {
			return ErrInvalid
		}
		for k, v := range changes {
			merged[k] = v
		}
		body = merged
	default:
		return ErrInvalid
	}
	raw, _, err := s.request(ctx, d.Service, profile, method, path, body)
	if err != nil {
		return err
	}
	var result map[string]any
	if json.Unmarshal(raw, &result) != nil || result == nil {
		return ErrUnavailable
	}
	switch d.Operation {
	case "refer_candidate", "request_benefit", "create_jira_issue", "update_jira_issue":
		if !validUUID(stringValue(result, "id")) {
			return ErrUnavailable
		}
	case "set_exit_step":
		if result["step"] != p["step"] || result["checked"] != p["checked"] {
			return ErrUnavailable
		}
	case "save_exit_draft":
		if result["date"] != p["date"] {
			return ErrUnavailable
		}
	}
	return nil
}
func (s *Service) Register(mux *http.ServeMux, identity func(*http.Request) (string, error)) {
	handler := func(action string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			profile, err := identity(r)
			if err != nil {
				httpError(w, http.StatusUnauthorized, "unauthenticated")
				return
			}
			var d Draft
			switch action {
			case "get":
				d, err = s.Get(r.Context(), profile, r.PathValue("action_id"))
			case "cancel", "confirm":
				var in struct {
					Confirm *bool `json:"confirm"`
				}
				r.Body = http.MaxBytesReader(w, r.Body, 1024)
				var raw json.RawMessage
				dec := json.NewDecoder(r.Body)
				if dec.Decode(&raw) != nil || dec.Decode(new(any)) != io.EOF || strict(raw, &in) != nil || in.Confirm == nil || (action == "confirm" && !*in.Confirm) || (action == "cancel" && *in.Confirm) {
					httpError(w, 400, "invalid_input")
					return
				}
				if action == "cancel" {
					d, err = s.Cancel(r.Context(), profile, r.PathValue("action_id"))
				} else {
					d, err = s.Confirm(r.Context(), profile, r.PathValue("action_id"))
				}
			}
			if err != nil {
				status, code := 503, "unavailable"
				switch {
				case errors.Is(err, ErrInvalid):
					status, code = 400, "invalid_input"
				case errors.Is(err, ErrNotFound):
					status, code = 404, "not_found"
				case errors.Is(err, ErrForbidden):
					status, code = 403, "forbidden"
				case errors.Is(err, ErrConflict):
					status, code = 409, "state_changed"
				}
				httpError(w, status, code)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(d)
		}
	}
	mux.HandleFunc("GET /api/v1/service-actions/{action_id}", handler("get"))
	mux.HandleFunc("POST /api/v1/service-actions/{action_id}/confirm", handler("confirm"))
	mux.HandleFunc("POST /api/v1/service-actions/{action_id}/cancel", handler("cancel"))
}
func httpError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code, "message": "Действие не выполнено. Проверь актуальные данные сервиса."})
}
