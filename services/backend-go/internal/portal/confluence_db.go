package portal

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// OpenKnowledgeDatabase copies legacy pages on the first demo start.
// Existing pages in the dedicated database take precedence on restart.
func (s *Service) OpenKnowledgeDatabase(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	conn, err := s.DB.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	if _, err = conn.Exec(ctx, "SELECT pg_advisory_lock(142790432)"); err != nil {
		return nil, err
	}
	defer conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock(142790432)")
	var exists bool
	if err = conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname='buddy_tool_confluence')").Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		if _, err = conn.Exec(ctx, "CREATE DATABASE buddy_tool_confluence"); err != nil {
			return nil, err
		}
	}
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	cfg.ConnConfig.Database = "buddy_tool_confluence"
	cfg.ConnConfig.RuntimeParams = map[string]string{}
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err = s.copyKnowledge(ctx, pool); err != nil {
		pool.Close()
		return nil, fmt.Errorf("copy Confluence pages: %w", err)
	}
	s.KnowledgeDB = pool
	return pool, nil
}

func (s *Service) copyKnowledge(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS confluence_pages (
		id text PRIMARY KEY, product_id text, parent_id text, kind text NOT NULL,
		title text NOT NULL, body text NOT NULL, version integer NOT NULL,
		updated_at timestamptz NOT NULL
	)`); err != nil {
		return err
	}
	// Refresh copies so subsequent migrations to the demo corpus also reach the service.
	rows, err := s.DB.Query(ctx, pageSelect)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		p, err := scanPage(rows)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO confluence_pages
			(id,product_id,parent_id,kind,title,body,version,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::text::timestamptz)
			ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,parent_id=excluded.parent_id,kind=excluded.kind,
			title=excluded.title,body=excluded.body,version=excluded.version,updated_at=excluded.updated_at
			WHERE confluence_pages.version < excluded.version`,
			p.ID, p.Product, p.Parent, p.Kind, p.Title, p.Body, p.Version, p.Updated); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) knowledgeDB() *pgxpool.Pool {
	if s.KnowledgeDB != nil {
		return s.KnowledgeDB
	}
	return s.DB
}
