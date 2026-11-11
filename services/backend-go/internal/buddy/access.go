package buddy

import (
	"context"
	"errors"
	"time"
)

type AccessRequestDraft struct {
	ID        string
	ProfileID string
	ServiceID string
	ExpiresAt time.Time
}

type AccessRequest struct {
	ID          string
	Number      string
	ServiceName string
	Status      string
}

type accessStore interface {
	ListRequestsByProfile(ctx context.Context, profileID string) ([]AccessRequest, error)
	DraftByOwner(ctx context.Context, draftID, profileID string) (AccessRequestDraft, error)
	HasPermission(ctx context.Context, profileID, serviceID string) (bool, error)
	RequestByDraft(ctx context.Context, draftID string) (AccessRequest, error)
	InsertRequest(ctx context.Context, d AccessRequestDraft) (AccessRequest, bool, error)
}

type corporateGateway interface {
	TryExecute(ctx context.Context, operationKey, serviceID, profileID string) (bool, error)
}

type Access struct {
	store accessStore
	corp  corporateGateway
}

func NewAccess(store accessStore, corp corporateGateway) *Access {
	return &Access{store: store, corp: corp}
}

func (s *Access) List(ctx context.Context, profileID string) ([]AccessRequest, error) {
	return s.store.ListRequestsByProfile(ctx, profileID)
}

func (s *Access) Confirm(ctx context.Context, draftID, profileID string) (AccessRequest, error) {
	if draftID == "" {
		return AccessRequest{}, ErrNotFound
	}
	draft, err := s.store.DraftByOwner(ctx, draftID, profileID)
	if err != nil {
		return AccessRequest{}, err
	}
	existing, err := s.store.RequestByDraft(ctx, draft.ID)
	switch {
	case err == nil:
		return existing, nil
	case !errors.Is(err, ErrNotFound):
		return AccessRequest{}, err
	}
	ok, err := s.store.HasPermission(ctx, profileID, draft.ServiceID)
	if err != nil {
		return AccessRequest{}, err
	}
	if !ok {
		return AccessRequest{}, ErrForbidden
	}
	if !draft.ExpiresAt.After(time.Now()) {
		return AccessRequest{}, ErrExpiredDraft
	}
	executed, err := s.corp.TryExecute(ctx, draft.ID, draft.ServiceID, profileID)
	if err != nil {
		return AccessRequest{}, err
	}
	if !executed {
		return AccessRequest{}, ErrUnavailable
	}
	req, created, err := s.store.InsertRequest(ctx, draft)
	if err != nil {
		return AccessRequest{}, err
	}
	if !created {
		return s.store.RequestByDraft(ctx, draft.ID)
	}
	return req, nil
}
