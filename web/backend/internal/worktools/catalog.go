package worktools

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed demo.json
var fixtures []byte

type Record struct {
	Team        string            `json:"team"`
	ID          string            `json:"id"`
	Title       string            `json:"title"`
	Status      string            `json:"status"`
	Description string            `json:"description"`
	Fields      map[string]string `json:"fields"`
}

type Page struct {
	Name    string   `json:"name"`
	Area    string   `json:"area"`
	Records []Record `json:"records"`
}

type Catalog struct {
	services map[string]Page
	pools    map[string]*pgxpool.Pool
}

func Open(ctx context.Context, admin *pgxpool.Pool, databaseURL string) (*Catalog, error) {
	c := &Catalog{pools: make(map[string]*pgxpool.Pool)}
	if err := json.Unmarshal(fixtures, &c.services); err != nil {
		return nil, err
	}
	conn, err := admin.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	// Serialize provisioning for processes sharing a demo PostgreSQL cluster.
	if _, err = conn.Exec(ctx, "SELECT pg_advisory_lock(142790431)"); err != nil {
		return nil, err
	}
	defer conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock(142790431)")
	for _, service := range slices.Sorted(maps.Keys(c.services)) {
		db := "buddy_tool_" + strings.ReplaceAll(service, "-", "_")
		var exists bool
		if err = conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname=$1)", db).Scan(&exists); err != nil {
			c.Close()
			return nil, err
		}
		if !exists {
			if _, err = conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{db}.Sanitize()); err != nil {
				c.Close()
				return nil, err
			}
		}
		if err = c.seed(ctx, databaseURL, db, service); err != nil {
			c.Close()
			return nil, fmt.Errorf("%s: %w", service, err)
		}
	}
	return c, nil
}

func (c *Catalog) seed(ctx context.Context, databaseURL, database, service string) error {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return err
	}
	cfg.ConnConfig.Database = database
	cfg.ConnConfig.RuntimeParams = map[string]string{}
	cfg.MaxConns = 2
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return err
	}
	c.pools[service] = pool
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS records (team text NOT NULL, id text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (team, id))"); err != nil {
		return err
	}
	for _, record := range c.services[service].Records {
		if _, err = tx.Exec(ctx, "INSERT INTO records (team,id,payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", record.Team, record.ID, record); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (c *Catalog) Close() {
	for _, pool := range c.pools {
		pool.Close()
	}
}

func (c *Catalog) Read(ctx context.Context, team, service string) (Page, error) {
	meta, ok := c.services[service]
	if !ok || !slices.ContainsFunc(meta.Records, func(r Record) bool { return r.Team == team }) {
		return Page{}, buddy.ErrNotFound
	}
	page := Page{Name: meta.Name, Area: meta.Area, Records: []Record{}}
	rows, err := c.pools[service].Query(ctx, "SELECT payload FROM records WHERE team=$1 ORDER BY id LIMIT 100", team)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var record Record
		if err := rows.Scan(&record); err != nil {
			return Page{}, err
		}
		page.Records = append(page.Records, record)
	}
	return page, rows.Err()
}

// Search exposes matching live demo records through the existing MCP knowledge search.
func (c *Catalog) Search(ctx context.Context, team, question string, limit int) ([]any, error) {
	query := strings.ToLower(question)
	docs := []any{}
	for _, service := range slices.Sorted(maps.Keys(c.services)) {
		meta := c.services[service]
		matches := strings.Contains(query, strings.ToLower(meta.Name)) ||
			strings.Contains(query, service) ||
			(service == "redash" && strings.Contains(query, "воронк"))
		if !matches {
			continue
		}
		page, err := c.Read(ctx, team, service)
		if err == buddy.ErrNotFound {
			continue
		}
		if err != nil {
			return nil, err
		}
		for _, record := range page.Records {
			if len(docs) == limit {
				return docs, nil
			}
			title := meta.Name + " · " + record.Title
			excerpt := record.Description + " Статус: " + record.Status + "."
			for _, key := range slices.Sorted(maps.Keys(record.Fields)) {
				excerpt += " " + key + ": " + record.Fields[key] + "."
			}
			docs = append(docs, map[string]any{
				"source": map[string]any{"id": service + ":" + record.ID, "title": title, "version": "1",
					"url": "/work-tools/" + service + "#" + record.ID, "is_demo": true},
				"excerpt": excerpt,
			})
		}
	}
	return docs, nil
}
