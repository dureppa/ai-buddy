package portal

import (
	"context"
	"maps"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/stretchr/testify/require"
)

func TestValidateRequestUsesEveryAllowedTemplateWithoutWriting(t *testing.T) {
	service := testService(t)
	ctx := context.Background()
	for _, profile := range []string{"olga", "sasha", "timur", "maria"} {
		catalog, err := service.GetCatalog(ctx, profile)
		require.NoError(t, err)
		for _, template := range catalog["templates"].([]Template) {
			t.Run(profile+"/"+template.ID, func(t *testing.T) {
				require.NotEmpty(t, template.Resources)
				resource := template.Resources[0]
				fields := maps.Clone(resource.Fields)
				for _, field := range template.Fields {
					if fields[field.Key] == "" {
						fields[field.Key] = "Параметр из диалога"
						if len(field.Options) > 0 {
							fields[field.Key] = field.Options[0]
						}
					}
				}
				input := Input{TemplateID: template.ID, Version: service.Catalog.Version, System: template.System,
					Key: resource.Key, Permission: template.Levels[0], Days: 30, Justification: "  Материалы для первой задачи команды  ", Fields: fields}
				valid, selected, err := service.ValidateRequest(ctx, profile, input)
				require.NoError(t, err)
				require.Equal(t, template.ID, selected.ID)
				require.Equal(t, resource.Key, valid.Key)
				require.Equal(t, "Материалы для первой задачи команды", valid.Justification)
				requests, err := service.List(ctx, profile)
				require.NoError(t, err)
				require.Empty(t, requests)
			})
		}
	}
}

func TestValidateBIRequestRejectsMissingFieldsForeignResourceAndVersion(t *testing.T) {
	service := testService(t)
	input := Input{TemplateID: "bi", Version: 1, System: "BI", Key: "delivery-bi", Permission: "read",
		Days: 30, Justification: "Проверить метрики команды доставки", Fields: map[string]string{"workspace": "Путь заказа"}}
	_, template, err := service.ValidateRequest(t.Context(), "olga", input)
	require.NoError(t, err)
	require.Equal(t, "bi", template.ID)
	for _, change := range []func(*Input){
		func(in *Input) { in.Key = "travel-bi" },
		func(in *Input) { in.Fields = map[string]string{} },
		func(in *Input) { in.TemplateID = "BI" },
		func(in *Input) { in.Permission = "admin" },
		func(in *Input) { in.Version = 2 },
		func(in *Input) { in.Days = 0 },
		func(in *Input) { in.Justification = "short" },
	} {
		bad := input
		change(&bad)
		_, _, err := service.ValidateRequest(t.Context(), "olga", bad)
		require.Error(t, err)
	}
	_, _, err = service.ValidateRequest(t.Context(), "unknown", input)
	require.ErrorIs(t, err, buddy.ErrForbidden)
}
