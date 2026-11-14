package store

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Store struct {
	q         querier
	pool      *pgxpool.Pool
	chatSlots chan struct{}
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{q: pool, pool: pool, chatSlots: make(chan struct{}, max(1, min(8, int(pool.Config().MaxConns)-2)))}
}
