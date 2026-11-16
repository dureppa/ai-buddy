package serviceactions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/dureppa/ai-buddy/web/backend/internal/portal"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
)

func TestAccessActionsForEveryTemplate(t *testing.T) {
	const accessKey = "synthetic-access-delegation-secret-32-characters"
	for _, template := range portal.New(nil).Catalog.Templates {
		t.Run(template.ID, func(t *testing.T) {
			fields := map[string]string{}
			for _, field := range template.Fields {
				value := "Учебное значение"
				if len(field.Options) > 0 {
					value = field.Options[0]
				}
				if strings.HasSuffix(field.Key, "_url") {
					value = "https://resource.example/team"
				}
				fields[field.Key] = value
			}
			role := "analyst"
			if len(template.Roles) > 0 {
				role = template.Roles[0]
			}
			template.Resources = []portal.Resource{{Key: "delivery-" + template.ID, Fields: fields}}
			identity := portal.Identity{ID: "olga", Product: "delivery", Role: role}
			var submitted atomic.Int32
			var revoked atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				claims := &jwt.RegisteredClaims{}
				_, err := jwt.ParseWithClaims(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), claims,
					func(*jwt.Token) (any, error) { return []byte(accessKey), nil }, jwt.WithAudience("access"), jwt.WithExpirationRequired())
				require.NoError(t, err)
				require.Equal(t, "olga", claims.Subject)
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "GET" {
					require.Equal(t, "/api/v1/portal-access/catalog", r.URL.Path)
					current := template
					if revoked.Load() {
						current.Resources = []portal.Resource{}
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"version": 1, "templates": []portal.Template{current}, "context": identity})
					return
				}
				require.Equal(t, "/api/v1/portal-access/requests", r.URL.Path)
				require.Equal(t, testID, r.Header.Get("Idempotency-Key"))
				require.Equal(t, "agent", r.Header.Get("X-Access-Origin"))
				var input portal.Input
				require.NoError(t, json.NewDecoder(r.Body).Decode(&input))
				require.Equal(t, template.Resources[0].Key, input.Key)
				require.Equal(t, fields, input.Fields)
				submitted.Add(1)
				_ = json.NewEncoder(w).Encode(portal.Request{ID: issueID, Profile: "olga", Product: "delivery", Input: input, Number: "ДОС-000042", Status: "submitted"})
			}))
			defer server.Close()
			access := portal.New(nil)
			var err error
			access.ExternalAccess, err = portal.NewAccessClient(server.URL, accessKey)
			require.NoError(t, err)
			service, err := New(&memoryStore{drafts: map[string]Draft{}}, Config{HRSecret: hrKey})
			require.NoError(t, err)
			service.Access = access
			input := portal.Input{TemplateID: template.ID, Version: 1, System: template.System, Key: template.Resources[0].Key,
				Permission: template.Levels[0], Days: 30, Justification: "  Материалы для первой задачи команды  ", Fields: fields}
			raw, _ := json.Marshal(input)
			var action map[string]any
			require.NoError(t, json.Unmarshal(raw, &action))
			action["operation"] = "request_access"
			ctx := context.Background()
			prepared, err := service.Prepare(ctx, "olga", testID, map[string]any{"action": action})
			require.NoError(t, err)
			draft := prepared["draft"].(Draft)
			require.Equal(t, "access", draft.Service)
			require.Equal(t, "prepared", draft.State)
			require.Contains(t, draft.Fields, Field{"Ресурс", input.Key})
			require.Contains(t, draft.Fields, Field{"Обоснование", strings.TrimSpace(input.Justification)})
			_, err = service.Get(ctx, "olga", draft.ID)
			require.NoError(t, err)
			require.Zero(t, submitted.Load(), "prepare/read must not submit")
			_, err = service.Confirm(ctx, "sasha", draft.ID)
			require.ErrorIs(t, err, ErrNotFound)
			revoked.Store(true)
			_, err = service.Confirm(ctx, "olga", draft.ID)
			require.ErrorIs(t, err, ErrForbidden)
			require.Zero(t, submitted.Load())
			revoked.Store(false)
			done, err := service.Confirm(ctx, "olga", draft.ID)
			require.NoError(t, err)
			require.Equal(t, "succeeded", done.State)
			require.Contains(t, done.Result, "ДОС-000042")
			require.Contains(t, done.Result, "не выдача прав")
			again, err := service.Confirm(ctx, "olga", draft.ID)
			require.NoError(t, err)
			require.Equal(t, done.Result, again.Result)
			require.EqualValues(t, 1, submitted.Load())
		})
	}
}

func TestAccessErrorsAndMalformedParameters(t *testing.T) {
	for _, test := range []struct{ in, want error }{
		{nil, nil}, {buddy.ErrInvalidInput, ErrInvalid}, {buddy.ErrForbidden, ErrForbidden},
		{buddy.ErrUnauthenticated, ErrForbidden}, {buddy.ErrNotFound, ErrNotFound}, {portal.ErrConflict, ErrConflict}, {errors.New("network"), ErrUnavailable},
	} {
		require.ErrorIs(t, accessError(test.in), test.want)
	}
	_, err := accessInput(map[string]any{"profile_id": "sasha"})
	require.ErrorIs(t, err, ErrInvalid)
	_, err = accessInput(map[string]any{"fields": []string{"forged"}})
	require.ErrorIs(t, err, ErrInvalid)
	service := &Service{}
	_, err = service.planAccess(context.Background(), "olga", nil)
	require.ErrorIs(t, err, ErrUnavailable)
	_, err = service.executeAccess(context.Background(), "olga", Draft{}, nil)
	require.ErrorIs(t, err, ErrUnavailable)
}
