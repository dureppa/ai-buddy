package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const schema = `
CREATE TABLE IF NOT EXISTS offboarding_settings (
    profile_id       text PRIMARY KEY,
    exit_notice_days integer NOT NULL CHECK (exit_notice_days >= 0)
);
CREATE TABLE IF NOT EXISTS offboarding_steps (
    id          text PRIMARY KEY,
    title       text NOT NULL,
    description text NOT NULL,
    sort_order  integer NOT NULL UNIQUE CHECK (sort_order > 0)
);
CREATE TABLE IF NOT EXISTS offboarding_checklist (
    profile_id text NOT NULL,
    step_id    text NOT NULL REFERENCES offboarding_steps (id),
    PRIMARY KEY (profile_id, step_id)
);
CREATE TABLE IF NOT EXISTS offboarding_drafts (
    profile_id text PRIMARY KEY,
    last_day   date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);`

const seed = `
INSERT INTO offboarding_settings (profile_id, exit_notice_days) VALUES
    ('olga', 14), ('sasha', 14), ('maria', 7)
ON CONFLICT (profile_id) DO NOTHING;
INSERT INTO offboarding_steps (id, title, description, sort_order) VALUES
    ('handover',  'Передать задачи и рабочие материалы', 'Поделись статусами и ссылками с лидом.', 1),
    ('equipment', 'Согласовать возврат техники',         'Уточни дату и способ возврата у IT.',    2),
    ('feedback',  'Запланировать итоговую встречу',      'Обсуди результаты с наставником.',       3)
ON CONFLICT (id) DO NOTHING;
INSERT INTO offboarding_checklist (profile_id, step_id) VALUES
    ('sasha', 'handover'),
    ('maria', 'handover'),
    ('maria', 'equipment')
ON CONFLICT (profile_id, step_id) DO NOTHING;`

func main() {
	loadEnv()
	addr := getenv("HTTP_ADDR", ":8184")
	secret := os.Getenv("SESSION_SECRET")
	if secret == "" {
		slog.Error("SESSION_SECRET не задан: возьми его из services/backend-go/.env")
		os.Exit(1)
	}

	ctx := context.Background()
	if err := ensureCluster(ctx); err != nil {
		slog.Error("подготовка роли и базы", "error", err)
		os.Exit(1)
	}

	pool, err := pgxpool.New(ctx, "")
	if err != nil {
		slog.Error("подключение к БД", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		slog.Error("БД недоступна", "error", err)
		os.Exit(1)
	}
	for _, stmt := range []string{schema, seed} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			slog.Error("инициализация схемы", "error", err)
			os.Exit(1)
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/me/offboarding", requireAuth(secret, handleSummary(pool)))
	mux.HandleFunc("PUT /api/v1/me/offboarding/checklist/{step}", requireAuth(secret, handleToggle(pool)))
	mux.HandleFunc("POST /api/v1/me/offboarding/draft", requireAuth(secret, handleDraft(pool)))

	slog.Info("hr-offboarding слушает", "addr", addr, "db", os.Getenv("PGDATABASE"))
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("сервер остановлен", "error", err)
		os.Exit(1)
	}
}

func handleSummary(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		noticeDays, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}

		stepRows, err := pool.Query(r.Context(),
			`SELECT id, title, description FROM offboarding_steps ORDER BY sort_order`)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer stepRows.Close()

		steps := make([]map[string]any, 0)
		for stepRows.Next() {
			var id, title, description string
			if err := stepRows.Scan(&id, &title, &description); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			steps = append(steps, map[string]any{"id": id, "title": title, "description": description})
		}

		checkRows, err := pool.Query(r.Context(),
			`SELECT step_id FROM offboarding_checklist WHERE profile_id = $1`, profile)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer checkRows.Close()

		checklist := make([]string, 0)
		for checkRows.Next() {
			var stepID string
			if err := checkRows.Scan(&stepID); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			checklist = append(checklist, stepID)
		}

		var draft any
		var lastDay string
		err = pool.QueryRow(r.Context(),
			`SELECT last_day::text FROM offboarding_drafts WHERE profile_id = $1`, profile).Scan(&lastDay)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if err == nil {
			draft = map[string]any{"date": lastDay}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"exit_notice_days": noticeDays,
			"earliest_exit":    addDays(today(), noticeDays),
			"steps":            steps,
			"checklist":        checklist,
			"draft":            draft,
		})
	}
}

func handleToggle(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		stepID := r.PathValue("step")
		var body struct {
			Checked bool `json:"checked"`
		}
		if err := readBody(w, r, &body); err != nil {
			fail(w, http.StatusBadRequest, "invalid_input", "нужно поле checked")
			return
		}

		var stepKnown bool
		if err := pool.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM offboarding_steps WHERE id = $1)`, stepID).Scan(&stepKnown); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if !stepKnown {
			fail(w, http.StatusBadRequest, "invalid_input", "Неизвестный шаг подготовки.")
			return
		}

		var hasDraft bool
		if err := pool.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM offboarding_drafts WHERE profile_id = $1)`, profile).Scan(&hasDraft); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if hasDraft {
			fail(w, http.StatusBadRequest, "invalid_input", "Черновик уже сохранён.")
			return
		}

		if body.Checked {
			_, err := pool.Exec(r.Context(), `
				INSERT INTO offboarding_checklist (profile_id, step_id) VALUES ($1, $2)
				ON CONFLICT (profile_id, step_id) DO NOTHING`, profile, stepID)
			if err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка записи")
				return
			}
		} else {
			if _, err := pool.Exec(r.Context(),
				`DELETE FROM offboarding_checklist WHERE profile_id = $1 AND step_id = $2`,
				profile, stepID); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка записи")
				return
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{"step": stepID, "checked": body.Checked})
	}
}

func handleDraft(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		var body struct {
			Date string `json:"date"`
		}
		if err := readBody(w, r, &body); err != nil {
			fail(w, http.StatusBadRequest, "invalid_input", "нужно поле date")
			return
		}

		var hasDraft bool
		if err := pool.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM offboarding_drafts WHERE profile_id = $1)`, profile).Scan(&hasDraft); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if hasDraft {
			fail(w, http.StatusBadRequest, "invalid_input", "Черновик уже сохранён.")
			return
		}

		noticeDays, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}

		var done, total int
		if err := pool.QueryRow(r.Context(),
			`SELECT count(*) FROM offboarding_checklist WHERE profile_id = $1`, profile).Scan(&done); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if err := pool.QueryRow(r.Context(),
			`SELECT count(*) FROM offboarding_steps`).Scan(&total); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if done < total {
			fail(w, http.StatusBadRequest, "invalid_input", "Отметь все шаги подготовки.")
			return
		}

		if _, perr := time.Parse("2006-01-02", body.Date); perr != nil || body.Date < addDays(today(), noticeDays) {
			fail(w, http.StatusBadRequest, "invalid_input", "Выбери дату с учётом срока уведомления.")
			return
		}

		if _, err := pool.Exec(r.Context(),
			`INSERT INTO offboarding_drafts (profile_id, last_day) VALUES ($1, $2::date)`,
			profile, body.Date); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка записи")
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{"date": body.Date})
	}
}

func settings(ctx context.Context, pool *pgxpool.Pool, profile string) (int, error) {
	var noticeDays int
	err := pool.QueryRow(ctx,
		`SELECT exit_notice_days FROM offboarding_settings WHERE profile_id = $1`, profile).Scan(&noticeDays)
	return noticeDays, err
}

func failSettings(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusNotFound, "not_found", "профиль не найден")
		return
	}
	fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
}

func today() string {
	loc, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		loc = time.FixedZone("MSK", 3*60*60)
	}
	return time.Now().In(loc).Format("2006-01-02")
}

func addDays(date string, n int) string {
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return t.AddDate(0, 0, n).Format("2006-01-02")
}

func ensureCluster(ctx context.Context) error {
	user := getenv("PGUSER", "hr_offboarding")
	password := os.Getenv("PGPASSWORD")
	database := os.Getenv("PGDATABASE")
	if database == "" {
		return fmt.Errorf("PGDATABASE не задан в .env")
	}

	adminUser := getenv("PGADMIN_USER", "postgres")
	adminPass := os.Getenv("PGADMIN_PASSWORD")
	sslmode := getenv("PGSSLMODE", "disable")

	u := &url.URL{
		Scheme:   "postgres",
		Host:     net.JoinHostPort(getenv("PGHOST", "localhost"), getenv("PGPORT", "5432")),
		Path:     "/postgres",
		RawQuery: url.Values{"sslmode": []string{sslmode}}.Encode(),
	}
	if adminPass != "" {
		u.User = url.UserPassword(adminUser, adminPass)
	} else {
		u.User = url.User(adminUser)
	}

	conn, err := pgx.Connect(ctx, u.String())
	if err != nil {
		return fmt.Errorf("подключение под %s: %w (проверь PGADMIN_USER и PGADMIN_PASSWORD)", adminUser, err)
	}
	defer conn.Close(ctx)

	role := pgx.Identifier{user}.Sanitize()
	var exists bool
	if err := conn.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1)`, user).Scan(&exists); err != nil {
		return fmt.Errorf("проверка роли: %w", err)
	}
	if exists {
		if _, err := conn.Exec(ctx,
			fmt.Sprintf(`ALTER ROLE %s WITH LOGIN PASSWORD %s`, role, sqlLiteral(password))); err != nil {
			return fmt.Errorf("обновление роли: %w", err)
		}
	} else {
		if _, err := conn.Exec(ctx,
			fmt.Sprintf(`CREATE ROLE %s LOGIN PASSWORD %s`, role, sqlLiteral(password))); err != nil {
			return fmt.Errorf("создание роли: %w", err)
		}
		slog.Info("роль создана", "role", user)
	}

	if err := conn.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)`, database).Scan(&exists); err != nil {
		return fmt.Errorf("проверка базы: %w", err)
	}
	if !exists {
		if _, err := conn.Exec(ctx,
			fmt.Sprintf(`CREATE DATABASE %s OWNER %s`, pgx.Identifier{database}.Sanitize(), role)); err != nil {
			return fmt.Errorf("создание базы: %w", err)
		}
		slog.Info("база создана", "db", database)
	}
	return nil
}

func requireAuth(secret string, next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const prefix = "Bearer "
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, prefix) {
			fail(w, http.StatusUnauthorized, "unauthenticated", "нужен bearer-токен")
			return
		}
		claims := &jwt.RegisteredClaims{}
		token, err := jwt.ParseWithClaims(strings.TrimPrefix(header, prefix), claims,
			func(*jwt.Token) (any, error) { return []byte(secret), nil },
			jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
		if err != nil || !token.Valid || claims.Subject == "" {
			fail(w, http.StatusUnauthorized, "unauthenticated", "токен недействителен")
			return
		}
		next(w, r, claims.Subject)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"code": code, "message": message})
}

func readBody(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<16)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func sqlLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func loadEnv() {
	path := getenv("ENV_FILE", ".env")
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
