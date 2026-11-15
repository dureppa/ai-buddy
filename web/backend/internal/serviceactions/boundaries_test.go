package serviceactions

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPreparationRejectsIneligibleOrIncompleteServiceData(t *testing.T) {
	const referral = `{"operation":"refer_candidate","vacancy":"backend","name":"Иван Тест","email":"ivan@example.com"}`
	const benefit = `{"operation":"request_benefit","benefit":"sport"}`
	const exit = `{"operation":"save_exit_draft","date":"2026-12-10"}`
	const step = `{"operation":"set_exit_step","step":"handover","checked":false}`
	const jira = `{"operation":"create_jira_issue","board_id":"delivery","title":"Задача","priority":"high","assignee_id":"olga","due_date":"2026-12-11"}`

	for _, tc := range []struct {
		name, action, path, key string
		data                    any
		want                    error
	}{
		{"referral vacancies missing", referral, "/api/v1/me/referral-summary", "vacancies", false, ErrUnavailable},
		{"vacancy no longer listed", referral, "/api/v1/me/referral-summary", "vacancies", []any{}, ErrNotFound},
		{"referral quota malformed", referral, "/api/v1/me/referral-summary", "referral_left", "0", ErrUnavailable},
		{"referral quota exhausted", referral, "/api/v1/me/referral-summary", "referral_left", 0, ErrConflict},
		{"duplicate referral", referral, "/api/v1/me/referral-summary", "referrals", []any{map[string]string{"vacancy": "backend", "email": "IVAN@example.com"}}, ErrConflict},
		{"referral row malformed", referral, "/api/v1/me/referral-summary", "referrals", []any{"row"}, ErrUnavailable},
		{"unrelated referral", referral, "/api/v1/me/referral-summary", "referrals", []any{map[string]string{"vacancy": "backend", "email": "other@example.com"}}, nil},
		{"exit step missing", step, "/api/v1/me/offboarding", "steps", []any{}, ErrNotFound},
		{"exit steps malformed", step, "/api/v1/me/offboarding", "steps", false, ErrUnavailable},
		{"exit step uncheck", step, "/api/v1/me/offboarding", "checklist", []any{"handover"}, nil},
		{"exit date too early", exit, "/api/v1/me/offboarding", "earliest_exit", "2026-12-11", ErrInvalid},
		{"exit draft exists", exit, "/api/v1/me/offboarding", "draft", map[string]string{"date": "2026-12-09"}, ErrConflict},
		{"exit plan missing", exit, "/api/v1/me/offboarding", "steps", false, ErrUnavailable},
		{"exit checklist malformed", exit, "/api/v1/me/offboarding", "checklist", false, ErrUnavailable},
		{"exit checklist unfinished", exit, "/api/v1/me/offboarding", "checklist", []any{}, ErrConflict},
		{"benefit options unavailable", benefit, "/api/v1/me/benefit-summary", "options", false, ErrUnavailable},
		{"benefit amount malformed", benefit, "/api/v1/me/benefit-summary", "options", []any{map[string]any{"id": "sport", "available": true}}, ErrUnavailable},
		{"benefit budget malformed", benefit, "/api/v1/me/benefit-summary", "benefit_left", "1000", ErrUnavailable},
		{"benefit requests malformed", benefit, "/api/v1/me/benefit-summary", "requests", false, ErrUnavailable},
		{"benefit request row malformed", benefit, "/api/v1/me/benefit-summary", "requests", []any{1}, ErrUnavailable},
		{"benefit already requested", benefit, "/api/v1/me/benefit-summary", "requests", []any{map[string]string{"benefit": "sport"}}, ErrConflict},
		{"unrelated benefit request", benefit, "/api/v1/me/benefit-summary", "requests", []any{map[string]string{"benefit": "other"}}, nil},
		{"Jira members malformed", jira, "/api/v1/boards/delivery", "members", false, ErrUnavailable},
		{"Jira assignee shown by name", jira, "/api/v1/boards/delivery", "members", []any{map[string]string{"id": "olga", "name": "Ольга"}}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			f.readOverride = func(path string) any {
				if path != tc.path {
					return nil
				}
				response := fixtureRead(path).(map[string]any)
				response[tc.key] = tc.data
				return response
			}
			out, err := f.s.Prepare(t.Context(), "olga", issueID, map[string]any{"action": decodeMap(t, tc.action)})
			if tc.want != nil {
				require.ErrorIs(t, err, tc.want)
				require.Nil(t, out)
			} else {
				require.NoError(t, err)
				require.NotEmpty(t, out["draft"])
			}
			require.Zero(t, f.writes.Load())
		})
	}
}

func TestPreparationValidatesAllEditableFields(t *testing.T) {
	f := newFixture(t)
	for _, raw := range []string{
		`{"operation":"refer_candidate","vacancy":"../unknown","name":"Иван","email":"ivan@example.com"}`,
		`{"operation":"refer_candidate","vacancy":"backend","name":"Иван","email":false}`,
		`{"operation":"save_exit_draft","date":1}`,
		`{"operation":"create_jira_issue","board_id":"../unknown","title":"Задача"}`,
		`{"operation":"create_jira_issue","board_id":"delivery"}`,
		`{"operation":"create_jira_issue","board_id":"delivery","title":"Задача","description":1}`,
		`{"operation":"create_jira_issue","board_id":"delivery","title":"Задача","priority":"urgent"}`,
		`{"operation":"create_jira_issue","board_id":"delivery","title":"Задача","assignee_id":false}`,
		`{"operation":"create_jira_issue","board_id":"delivery","title":"Задача","due_date":false}`,
		`{"operation":"create_jira_issue","board_id":"delivery","title":"Задача","due_date":"2026-11-99"}`,
		`{"operation":"update_jira_issue","issue_id":"` + issueID + `","version":3,"changes":{"board_id":"travel"}}`,
	} {
		t.Run(raw, func(t *testing.T) {
			_, err := f.s.Prepare(t.Context(), "olga", issueID, map[string]any{"action": decodeMap(t, raw)})
			require.ErrorIs(t, err, ErrInvalid)
		})
	}
	for _, args := range []map[string]any{{}, {"action": "refer_candidate"}} {
		_, err := f.s.Prepare(t.Context(), "olga", issueID, args)
		require.ErrorIs(t, err, ErrInvalid)
	}
	require.Zero(t, f.writes.Load())
}

func TestReadContextBoundsListsAndRejectsBadSourceData(t *testing.T) {
	for _, tt := range []struct {
		service, path, key string
		limit              int
	}{
		{"hiring", "/api/v1/me/referral-summary", "referrals", 30},
		{"benefits", "/api/v1/me/benefit-summary", "requests", 30},
		{"jira", "/api/v1/boards/delivery", "issues", 20},
	} {
		t.Run(tt.service, func(t *testing.T) {
			f := newFixture(t)
			rows := make([]any, tt.limit+1)
			for i := range rows {
				rows[i] = map[string]any{"id": issueID, "title": "Задача"}
			}
			args := map[string]any{"service": tt.service}
			if tt.service == "jira" {
				args["board_id"] = "delivery"
			}
			f.readOverride = func(path string) any {
				if path != tt.path {
					return nil
				}
				out := fixtureRead(path).(map[string]any)
				out[tt.key] = rows
				return out
			}
			out, err := f.s.Context(t.Context(), "olga", args)
			require.NoError(t, err)
			require.Equal(t, true, out["has_more"])
			require.Len(t, out[tt.key], tt.limit)
		})
	}
	for _, tt := range []struct {
		name, service, path, key string
		value                    any
	}{
		{"missing referrals", "hiring", "/api/v1/me/referral-summary", "referrals", nil},
		{"malformed requests", "benefits", "/api/v1/me/benefit-summary", "requests", false},
		{"malformed issues", "jira", "/api/v1/boards/delivery", "issues", false},
		{"malformed issue row", "jira", "/api/v1/boards/delivery", "issues", []any{42}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f := newFixture(t)
			f.readOverride = func(path string) any {
				if path != tt.path {
					return nil
				}
				out := fixtureRead(path).(map[string]any)
				out[tt.key] = tt.value
				return out
			}
			args := map[string]any{"service": tt.service}
			if tt.service == "jira" {
				args["board_id"] = "delivery"
			}
			_, err := f.s.Context(t.Context(), "olga", args)
			require.ErrorIs(t, err, ErrUnavailable)
		})
	}
}

func TestDraftAndContextStorageFailures(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := f.s.Context(ctx, "olga", map[string]any{"service": "hiring"})
	require.ErrorIs(t, err, ErrUnavailable)
	_, err = f.s.Prepare(ctx, "olga", issueID, map[string]any{"action": map[string]any{"operation": "request_benefit", "benefit": "sport"}})
	require.ErrorIs(t, err, ErrUnavailable)
	_, err = f.s.Context(t.Context(), "olga", map[string]any{"service": "jira", "board_id": "absent"})
	require.ErrorIs(t, err, ErrNotFound)
	_, err = f.s.Context(t.Context(), "olga", map[string]any{"service": "jira", "issue_id": "00000000-0000-4000-8000-000000000001"})
	require.ErrorIs(t, err, ErrNotFound)

	_, err = boundContext(map[string]any{"fixed": strings.Repeat("x", 13000)}, []string{"issues"})
	require.ErrorIs(t, err, ErrUnavailable)
	_, err = boundContext(map[string]any{"invalid": func() {}}, nil)
	require.ErrorIs(t, err, ErrUnavailable)
}
