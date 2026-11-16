package calendar

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type PGStore struct{ Pool *pgxpool.Pool }

func demoEvents(profile string, now time.Time) []Event {
	titles := []string{"Встреча с лидом", "Кофе с наставником", "Знакомство с продуктом"}
	hours := []int{14, 11, 15}
	descriptions := []string{"Руководитель расскажет о задачах команды и обсудит твои цели на первые недели.", "Неформальное знакомство с наставником. Можно задать вопросы о команде и повседневной работе.", "Команда покажет пользовательские сценарии и расскажет, над чем работает сейчас."}
	if profile == "sasha" {
		titles = []string{"Встреча на экваторе"}
		hours = []int{12}
		descriptions = []string{"Обсуди с наставником результаты первых месяцев и цели на вторую половину стажировки."}
	}
	if profile == "maria" {
		titles = []string{"Итоговая встреча с лидом"}
		hours = []int{15}
		descriptions = []string{"Подведи итоги стажировки, обсуди обратную связь и договорись о следующих шагах."}
	}
	rows := []Event{}
	now = now.In(Moscow)
	for i, title := range titles {
		start := time.Date(now.Year(), now.Month(), now.Day()+i, hours[i], 0, 0, 0, Moscow)
		if !start.After(now) {
			start = start.AddDate(0, 0, 1)
		}
		rows = append(rows, Event{ID: fmt.Sprintf("demo-%d", i), Title: title, Kind: "Встреча", StartsAt: start.UTC(), Tone: "mint", Description: descriptions[i]})
	}
	return rows
}
func (s *PGStore) begin(ctx context.Context, profile string) (pgx.Tx, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "calendar:"+profile); err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	result, err := tx.Exec(ctx, `INSERT INTO calendar_state(profile_id) VALUES($1) ON CONFLICT DO NOTHING`, profile)
	if err == nil && result.RowsAffected() == 1 {
		for _, e := range demoEvents(profile, time.Now()) {
			_, err = tx.Exec(ctx, `INSERT INTO calendar_events(profile_id,id,title,kind,starts_at,description,origin) VALUES($1,$2,$3,$4,$5,$6,'seed')`, profile, e.ID, e.Title, e.Kind, e.StartsAt, e.Description)
			if err != nil {
				break
			}
		}
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
}
func (s *PGStore) List(ctx context.Context, profile string, from, to time.Time, limit int) ([]Event, bool, error) {
	tx, err := s.begin(ctx, profile)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `SELECT id,title,kind,starts_at,description FROM calendar_events WHERE profile_id=$1 AND NOT deleted AND starts_at >= $2 AND starts_at < $3 ORDER BY starts_at,id LIMIT $4`, profile, from, to, limit+1)
	if err != nil {
		return nil, false, err
	}
	out := []Event{}
	for rows.Next() {
		var e Event
		if err = rows.Scan(&e.ID, &e.Title, &e.Kind, &e.StartsAt, &e.Description); err != nil {
			rows.Close()
			return nil, false, err
		}
		e.StartsAt = e.StartsAt.UTC()
		e.Tone = Tone(e.Kind)
		out = append(out, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, tx.Commit(ctx)
}
func (s *PGStore) Put(ctx context.Context, profile string, e Event, createOnly bool) (Event, error) {
	tx, err := s.begin(ctx, profile)
	if err != nil {
		return Event{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if !e.StartsAt.After(time.Now()) {
		var unchanged bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM calendar_events WHERE profile_id=$1 AND id=$2 AND starts_at=$3 AND NOT deleted)`, profile, e.ID, e.StartsAt).Scan(&unchanged); err != nil {
			return Event{}, err
		}
		if createOnly || !unchanged {
			return Event{}, ErrInvalid
		}
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM calendar_events WHERE profile_id=$1 AND NOT deleted`, profile).Scan(&count); err != nil {
		return Event{}, err
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM calendar_events WHERE profile_id=$1 AND id=$2 AND NOT deleted)`, profile, e.ID).Scan(&exists); err != nil {
		return Event{}, err
	}
	if count >= 500 && !exists {
		return Event{}, ErrInvalid
	}
	query := `INSERT INTO calendar_events(profile_id,id,title,kind,starts_at,description) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(profile_id,id) DO UPDATE SET title=excluded.title,kind=excluded.kind,starts_at=excluded.starts_at,description=excluded.description,origin='user',deleted=false`
	if createOnly {
		query = `INSERT INTO calendar_events(profile_id,id,title,kind,starts_at,description) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(profile_id,id) DO UPDATE SET id=excluded.id WHERE NOT calendar_events.deleted AND calendar_events.title=excluded.title AND calendar_events.kind=excluded.kind AND calendar_events.starts_at=excluded.starts_at AND calendar_events.description=excluded.description`
	}
	result, err := tx.Exec(ctx, query, profile, e.ID, e.Title, e.Kind, e.StartsAt, e.Description)
	if err != nil {
		return Event{}, err
	}
	if result.RowsAffected() == 0 {
		return Event{}, ErrInvalid
	}
	return e, tx.Commit(ctx)
}
func (s *PGStore) Delete(ctx context.Context, profile, id string) error {
	tx, err := s.begin(ctx, profile)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := tx.Exec(ctx, `UPDATE calendar_events SET deleted=true,origin='user' WHERE profile_id=$1 AND id=$2`, profile, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}
func (s *PGStore) Import(ctx context.Context, profile string, events []Event) error {
	tx, err := s.begin(ctx, profile)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var imported bool
	if err = tx.QueryRow(ctx, `SELECT imported FROM calendar_state WHERE profile_id=$1`, profile).Scan(&imported); err != nil {
		return err
	}
	if !imported {
		if _, err = tx.Exec(ctx, `DELETE FROM calendar_events WHERE profile_id=$1 AND origin='seed'`, profile); err != nil {
			return err
		}
	}
	for _, e := range events {
		if _, err = tx.Exec(ctx, `INSERT INTO calendar_events(profile_id,id,title,kind,starts_at,description) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(profile_id,id) DO NOTHING`, profile, e.ID, e.Title, e.Kind, e.StartsAt, e.Description); err != nil {
			return err
		}
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM calendar_events WHERE profile_id=$1 AND NOT deleted`, profile).Scan(&count); err != nil {
		return err
	}
	if count > 500 {
		return ErrInvalid
	}
	if _, err = tx.Exec(ctx, `UPDATE calendar_state SET imported=true WHERE profile_id=$1`, profile); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
