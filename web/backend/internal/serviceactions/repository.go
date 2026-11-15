package serviceactions

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PGStore struct{ Pool *pgxpool.Pool }

const columns = `id::text,profile_id,request_id::text,service,operation,fingerprint,payload,title,fields,service_url,state,result,expires_at,started_at`

func scan(row pgx.Row) (Draft, error) {
	var d Draft
	var fields []byte
	err := row.Scan(&d.ID, &d.Profile, &d.RequestID, &d.Service, &d.Operation, &d.Fingerprint, &d.Payload, &d.Title, &fields, &d.ServiceURL, &d.State, &d.Result, &d.ExpiresAt, &d.StartedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	if err != nil {
		return d, err
	}
	err = json.Unmarshal(fields, &d.Fields)
	return d, err
}
func (s *PGStore) Save(ctx context.Context, d Draft) (Draft, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Draft{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, d.Profile+":"+d.Fingerprint); err != nil {
		return Draft{}, err
	}
	old, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM service_action_drafts WHERE profile_id=$1 AND fingerprint=$2 AND (request_id=$3::uuid OR (expires_at>now() AND state IN ('prepared','succeeded')) OR state IN ('executing','uncertain')) ORDER BY created_at DESC LIMIT 1`, d.Profile, d.Fingerprint, d.RequestID))
	if err == nil {
		return old, tx.Commit(ctx)
	}
	if !errors.Is(err, ErrNotFound) {
		return Draft{}, err
	}
	fields, _ := json.Marshal(d.Fields)
	out, err := scan(tx.QueryRow(ctx, `INSERT INTO service_action_drafts(profile_id,request_id,service,operation,fingerprint,payload,title,fields,service_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+columns, d.Profile, d.RequestID, d.Service, d.Operation, d.Fingerprint, d.Payload, d.Title, fields, d.ServiceURL))
	if err != nil {
		return Draft{}, err
	}
	return out, tx.Commit(ctx)
}
func (s *PGStore) Get(ctx context.Context, profile, id string) (Draft, error) {
	return scan(s.Pool.QueryRow(ctx, `SELECT `+columns+` FROM service_action_drafts WHERE profile_id=$1 AND id::text=$2`, profile, id))
}
func (s *PGStore) Claim(ctx context.Context, profile, id string) (Draft, bool, error) {
	d, err := scan(s.Pool.QueryRow(ctx, `UPDATE service_action_drafts SET state='executing',started_at=now() WHERE profile_id=$1 AND id::text=$2 AND state='prepared' AND expires_at>now() RETURNING `+columns, profile, id))
	if errors.Is(err, ErrNotFound) {
		d, err = s.Get(ctx, profile, id)
		return d, false, err
	}
	return d, err == nil, err
}
func (s *PGStore) Finish(ctx context.Context, profile, id, state, message string) (Draft, error) {
	return scan(s.Pool.QueryRow(ctx, `UPDATE service_action_drafts SET state=$3,result=$4 WHERE profile_id=$1 AND id::text=$2 AND state='executing' RETURNING `+columns, profile, id, state, message))
}
func (s *PGStore) Cancel(ctx context.Context, profile, id string) (Draft, error) {
	d, err := scan(s.Pool.QueryRow(ctx, `UPDATE service_action_drafts SET state='cancelled' WHERE profile_id=$1 AND id::text=$2 AND state='prepared' RETURNING `+columns, profile, id))
	if errors.Is(err, ErrNotFound) {
		return s.Get(ctx, profile, id)
	}
	return d, err
}
