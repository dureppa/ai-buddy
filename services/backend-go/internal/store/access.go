package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

func (s *Store) ListRequestsByProfile(ctx context.Context, profileID string) ([]buddy.AccessRequest, error) {
	rows, err := s.q.Query(ctx, `
		SELECT r.id, r.number, sv.name, r.status
		FROM access_requests r
		JOIN services sv ON sv.id = r.service_id
		WHERE r.profile_id = $1
		ORDER BY r.created_at DESC`, profileID)
	if err != nil {
		return nil, fmt.Errorf("list requests: %w", err)
	}
	defer rows.Close()

	reqs := make([]buddy.AccessRequest, 0)
	for rows.Next() {
		var r buddy.AccessRequest
		if err := rows.Scan(&r.ID, &r.Number, &r.ServiceName, &r.Status); err != nil {
			return nil, fmt.Errorf("scan request: %w", err)
		}
		reqs = append(reqs, r)
	}
	return reqs, rows.Err()
}

func (s *Store) DraftByOwner(ctx context.Context, draftID, profileID string) (buddy.AccessRequestDraft, error) {
	var d buddy.AccessRequestDraft
	err := s.q.QueryRow(ctx, `
		SELECT id, profile_id, service_id, expires_at
		FROM access_request_drafts
		WHERE id::text = $1 AND profile_id = $2`, draftID, profileID,
	).Scan(&d.ID, &d.ProfileID, &d.ServiceID, &d.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return buddy.AccessRequestDraft{}, buddy.ErrNotFound
	}
	if err != nil {
		return buddy.AccessRequestDraft{}, fmt.Errorf("draft by owner: %w", err)
	}
	return d, nil
}

func (s *Store) HasPermission(ctx context.Context, profileID, serviceID string) (bool, error) {
	var ok bool
	err := s.q.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM service_request_permissions
			WHERE profile_id = $1 AND service_id = $2)`, profileID, serviceID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("has permission: %w", err)
	}
	return ok, nil
}

func (s *Store) RequestByDraft(ctx context.Context, draftID string) (buddy.AccessRequest, error) {
	var r buddy.AccessRequest
	err := s.q.QueryRow(ctx, `
		SELECT r.id, r.number, sv.name, r.status
		FROM access_requests r
		JOIN services sv ON sv.id = r.service_id
		WHERE r.draft_id = $1`, draftID,
	).Scan(&r.ID, &r.Number, &r.ServiceName, &r.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return buddy.AccessRequest{}, buddy.ErrNotFound
	}
	if err != nil {
		return buddy.AccessRequest{}, fmt.Errorf("request by draft: %w", err)
	}
	return r, nil
}

func (s *Store) InsertRequest(ctx context.Context, d buddy.AccessRequestDraft) (buddy.AccessRequest, bool, error) {
	var r buddy.AccessRequest
	err := s.q.QueryRow(ctx, `
		INSERT INTO access_requests (draft_id, profile_id, service_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (draft_id) DO NOTHING
		RETURNING id, number, status,
		          (SELECT sv.name FROM services sv WHERE sv.id = service_id)`,
		d.ID, d.ProfileID, d.ServiceID,
	).Scan(&r.ID, &r.Number, &r.Status, &r.ServiceName)
	if errors.Is(err, pgx.ErrNoRows) {
		return buddy.AccessRequest{}, false, nil
	}
	if err != nil {
		return buddy.AccessRequest{}, false, fmt.Errorf("insert request: %w", err)
	}
	return r, true, nil
}
