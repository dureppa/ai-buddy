package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Corporate struct {
	q    querier
	fail bool
}

func NewCorporate(pool *pgxpool.Pool, fail bool) *Corporate {
	return &Corporate{q: pool, fail: fail}
}

func (c *Corporate) TryExecute(ctx context.Context, operationKey, serviceID, profileID string) (bool, error) {
	if c.fail {
		return false, nil
	}
	_, err := c.q.Exec(ctx, `
		INSERT INTO mock_service_operations (operation_key, service_id, profile_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (operation_key) DO NOTHING`, operationKey, serviceID, profileID)
	if err != nil {
		return false, fmt.Errorf("corporate operation: %w", err)
	}
	return true, nil
}
