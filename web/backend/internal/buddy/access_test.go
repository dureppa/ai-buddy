package buddy

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type accessFixture struct {
	draft                       AccessRequestDraft
	draftErr, requestErr        error
	permissionErr, executionErr error
	insertErr                   error
	allowed, executed, created  bool
	requestReads, executions    int
}

var requestRecord = AccessRequest{ID: "request", Number: "Д-101", ServiceName: "Grafana", Status: "submitted"}

func (s *accessFixture) ListRequestsByProfile(_ context.Context, profile string) ([]AccessRequest, error) {
	if profile != "olga" {
		return nil, nil
	}
	return []AccessRequest{requestRecord}, nil
}

func (s *accessFixture) DraftByOwner(_ context.Context, id, profile string) (AccessRequestDraft, error) {
	if id != s.draft.ID || profile != s.draft.ProfileID {
		return AccessRequestDraft{}, ErrNotFound
	}
	return s.draft, s.draftErr
}

func (s *accessFixture) HasPermission(context.Context, string, string) (bool, error) {
	return s.allowed, s.permissionErr
}

func (s *accessFixture) RequestByDraft(context.Context, string) (AccessRequest, error) {
	s.requestReads++
	if s.requestReads > 1 && s.executed && !s.created {
		return requestRecord, nil
	}
	return requestRecord, s.requestErr
}

func (s *accessFixture) InsertRequest(context.Context, AccessRequestDraft) (AccessRequest, bool, error) {
	return requestRecord, s.created, s.insertErr
}

func (s *accessFixture) TryExecute(context.Context, string, string, string) (bool, error) {
	s.executions++
	return s.executed, s.executionErr
}

func TestConfirmAccessUsesExistingRequestAndChecksEligibility(t *testing.T) {
	unavailable := errors.New("downstream temporarily offline")
	for _, tt := range []struct {
		name       string
		change     func(*accessFixture)
		err        error
		executions int
	}{
		{"new request", func(*accessFixture) {}, nil, 1},
		{"already confirmed", func(f *accessFixture) { f.requestErr = nil }, nil, 0},
		{"read draft failed", func(f *accessFixture) { f.draftErr = unavailable }, unavailable, 0},
		{"read request failed", func(f *accessFixture) { f.requestErr = unavailable }, unavailable, 0},
		{"permission lookup failed", func(f *accessFixture) { f.permissionErr = unavailable }, unavailable, 0},
		{"permission revoked", func(f *accessFixture) { f.allowed = false }, ErrForbidden, 0},
		{"expired", func(f *accessFixture) { f.draft.ExpiresAt = time.Now().Add(-time.Minute) }, ErrExpiredDraft, 0},
		{"execution transport failure", func(f *accessFixture) { f.executionErr = unavailable }, unavailable, 1},
		{"execution rejected", func(f *accessFixture) { f.executed = false }, ErrUnavailable, 1},
		{"failed to persist", func(f *accessFixture) { f.insertErr = unavailable }, unavailable, 1},
		{"concurrent winner", func(f *accessFixture) { f.created = false }, nil, 1},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fixture := &accessFixture{
				draft:      AccessRequestDraft{ID: "draft", ProfileID: "olga", ServiceID: "grafana", ExpiresAt: time.Now().Add(time.Minute)},
				requestErr: ErrNotFound, allowed: true, executed: true, created: true,
			}
			tt.change(fixture)
			service := NewAccess(fixture, fixture)
			_, err := service.Confirm(t.Context(), "", "olga")
			require.ErrorIs(t, err, ErrNotFound)
			_, err = service.Confirm(t.Context(), "draft", "maria")
			require.ErrorIs(t, err, ErrNotFound)
			got, err := service.Confirm(t.Context(), "draft", "olga")
			if tt.err != nil {
				require.ErrorIs(t, err, tt.err)
			} else {
				require.NoError(t, err)
				require.Equal(t, requestRecord, got)
			}
			require.Equal(t, tt.executions, fixture.executions)
			listed, err := service.List(t.Context(), "olga")
			require.NoError(t, err)
			require.Equal(t, []AccessRequest{requestRecord}, listed)
		})
	}
}
