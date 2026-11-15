package portal

import (
	"context"
	"encoding/json"
	"maps"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

// ValidateRequest checks the live scoped catalog without creating a request.
func (s *Service) ValidateRequest(ctx context.Context, subject string, input Input) (Input, Template, error) {
	data, err := s.GetCatalog(ctx, subject)
	if err != nil {
		return input, Template{}, err
	}
	var catalog struct {
		Catalog
		Context Identity `json:"context"`
	}
	raw, err := json.Marshal(data)
	if err != nil || json.Unmarshal(raw, &catalog) != nil || catalog.Context.ID != subject || catalog.Context.Product == "" || catalog.Version < 1 {
		return input, Template{}, buddy.ErrUnavailable
	}
	input.Fields = maps.Clone(input.Fields)
	validator := &Service{Catalog: catalog.Catalog}
	if err := validator.Validate(&input, catalog.Context); err != nil {
		return input, Template{}, err
	}
	for _, template := range catalog.Templates {
		if template.ID != input.TemplateID {
			continue
		}
		for _, resource := range template.Resources {
			if resource.Key != input.Key {
				continue
			}
			for key, value := range resource.Fields {
				if input.Fields[key] != value {
					return input, Template{}, buddy.ErrForbidden
				}
			}
			return input, template, nil
		}
		return input, Template{}, buddy.ErrForbidden
	}
	return input, Template{}, buddy.ErrInvalidInput
}
