package serviceactions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/dureppa/ai-buddy/web/backend/internal/portal"
)

func accessError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, buddy.ErrInvalidInput):
		return ErrInvalid
	case errors.Is(err, buddy.ErrForbidden), errors.Is(err, buddy.ErrUnauthenticated):
		return ErrForbidden
	case errors.Is(err, buddy.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, portal.ErrConflict):
		return ErrConflict
	default:
		return ErrUnavailable
	}
}

func accessInput(parameters map[string]any) (portal.Input, error) {
	var input portal.Input
	raw, err := json.Marshal(parameters)
	if err != nil || strict(raw, &input) != nil {
		return input, ErrInvalid
	}
	return input, nil
}

func (s *Service) planAccess(ctx context.Context, profile string, parameters map[string]any) (Draft, error) {
	if s.Access == nil {
		return Draft{}, ErrUnavailable
	}
	input, err := accessInput(parameters)
	if err != nil {
		return Draft{}, err
	}
	input, template, err := s.Access.ValidateRequest(ctx, profile, input)
	if err != nil {
		return Draft{}, accessError(err)
	}
	// Persist exactly the normalized values displayed in the confirmation.
	raw, _ := json.Marshal(input)
	if err = json.Unmarshal(raw, &parameters); err != nil {
		return Draft{}, ErrInvalid
	}
	permission := map[string]string{"read": "Чтение", "write": "Чтение и запись", "admin": "Администрирование"}[input.Permission]
	draft := Draft{Title: "Подать заявку на доступ: " + template.Title, ServiceURL: s.Access.AccessURL + "?tab=requests",
		Fields: []Field{{"Система", input.System}, {"Ресурс", input.Key}, {"Права", permission},
			{"Срок", fmt.Sprintf("%d дн.", input.Days)}, {"Обоснование", input.Justification}}}
	for _, field := range template.Fields {
		draft.Fields = append(draft.Fields, Field{field.Label, input.Fields[field.Key]})
	}
	return draft, nil
}

func (s *Service) executeAccess(ctx context.Context, profile string, draft Draft, parameters map[string]any) (string, error) {
	if s.Access == nil {
		return "", ErrUnavailable
	}
	input, err := accessInput(parameters)
	if err != nil {
		return "", err
	}
	request, err := s.Access.Submit(ctx, profile, input, draft.ID, "agent")
	if err != nil {
		return "", accessError(err)
	}
	if request.Profile != profile || request.Number == "" || (request.Status != "submitted" && request.Status != "approved") || !validUUID(request.ID) {
		return "", ErrUnavailable
	}
	return "Заявка " + request.Number + " принята и сохранена. Это заявка на доступ, а не выдача прав.", nil
}
