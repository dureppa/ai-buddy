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

	"github.com/dureppa/ai-buddy/tools/shared"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const schema = `
CREATE TABLE IF NOT EXISTS absence_settings (
    profile_id           text PRIMARY KEY,
    vacation_days        integer NOT NULL CHECK (vacation_days >= 0),
    vacation_notice_days integer NOT NULL CHECK (vacation_notice_days >= 0)
);
CREATE TABLE IF NOT EXISTS absence_requests (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id text NOT NULL,
    start_on   date NOT NULL,
    end_on     date NOT NULL,
    days       integer NOT NULL CHECK (days > 0),
    status     text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (end_on >= start_on)
);
CREATE INDEX IF NOT EXISTS absence_requests_profile_idx
    ON absence_requests (profile_id, created_at DESC);`

const seed = `
INSERT INTO absence_settings (profile_id, vacation_days, vacation_notice_days) VALUES
    ('olga',  7,  30),
    ('sasha', 16, 14),
    ('maria', 24, 7),
    ('timur', 7, 30)
ON CONFLICT (profile_id) DO NOTHING;`

func main() {
	loadEnv()
	addr := getenv("HTTP_ADDR", ":8182")
	secret := os.Getenv("SESSION_SECRET")
	if secret == "" {
		slog.Error("SESSION_SECRET не задан: возьми его из web/backend/.env")
		os.Exit(1)
	}

	ctx := context.Background()
	if os.Getenv("PGADMIN_USER") != "" {
		if err := ensureCluster(ctx); err != nil {
			slog.Error("подготовка роли и базы", "error", err)
			os.Exit(1)
		}
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
	isDemo := os.Getenv("DEMO_MODE") == "true"
	demoSecret := os.Getenv("HR_DEMO_SIGNING_SECRET")
	if isDemo && (len(demoSecret) < 32 || demoSecret == secret) {
		slog.Error("для демосессий нужен отдельный HR_DEMO_SIGNING_SECRET длиной от 32 байт")
		os.Exit(1)
	}
	sessions := shared.Sessions{Secret: []byte(demoSecret), Audience: "hr-absences", Demo: isDemo}
	mux.HandleFunc("POST /api/v1/demo/sessions", sessions.Login)
	auth := func(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
		return sessions.WithDemoSession(next, requireAuth(secret, next))
	}

	mux.HandleFunc("GET /api/v1/me/absence-summary", auth(handleSummary(pool)))
	mux.HandleFunc("POST /api/v1/me/absence-requests", auth(handleCreate(pool)))

	slog.Info("hr-absences слушает", "addr", addr, "db", os.Getenv("PGDATABASE"))
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("сервер остановлен", "error", err)
		os.Exit(1)
	}
}

func handleSummary(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		vacationDays, noticeDays, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}

		var used int
		if err := pool.QueryRow(r.Context(),
			`SELECT coalesce(sum(days), 0) FROM absence_requests WHERE profile_id = $1`,
			profile).Scan(&used); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}

		rows, err := pool.Query(r.Context(), `
			SELECT id::text, start_on::text, end_on::text, days, status
			FROM absence_requests
			WHERE profile_id = $1
			ORDER BY created_at DESC`, profile)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer rows.Close()

		requests := make([]map[string]any, 0)
		for rows.Next() {
			var id, start, end, status string
			var days int
			if err := rows.Scan(&id, &start, &end, &days, &status); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			requests = append(requests, map[string]any{
				"id": id, "start": start, "end": end, "days": days, "status": status,
			})
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"vacation_days":        vacationDays,
			"vacation_notice_days": noticeDays,
			"vacation_left":        vacationDays - used,
			"earliest_vacation":    addDays(today(), noticeDays),
			"requests":             requests,
		})
	}
}

func handleCreate(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		var body struct {
			Start string `json:"start"`
			End   string `json:"end"`
		}
		if err := readBody(w, r, &body); err != nil {
			fail(w, http.StatusBadRequest, "invalid_input", "нужны поля start и end")
			return
		}

		start, errStart := time.Parse("2006-01-02", body.Start)
		end, errEnd := time.Parse("2006-01-02", body.End)
		if errStart != nil || errEnd != nil || body.End < body.Start {
			fail(w, http.StatusBadRequest, "invalid_input", "Выбери начало и конец отпуска.")
			return
		}

		vacationDays, noticeDays, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}
		if body.Start < addDays(today(), noticeDays) {
			fail(w, http.StatusBadRequest, "invalid_input", "Для этих дат срок подачи уже прошёл.")
			return
		}

		var overlap bool
		if err := pool.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM absence_requests
				WHERE profile_id = $1 AND start_on <= $3::date AND $2::date <= end_on)`,
			profile, body.Start, body.End).Scan(&overlap); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if overlap {
			fail(w, http.StatusBadRequest, "invalid_input", "Период пересекается с другой заявкой.")
			return
		}

		days := int(end.Sub(start).Hours()/24) + 1

		var used int
		if err := pool.QueryRow(r.Context(),
			`SELECT coalesce(sum(days), 0) FROM absence_requests WHERE profile_id = $1`,
			profile).Scan(&used); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if days > vacationDays-used {
			fail(w, http.StatusBadRequest, "invalid_input", "На этот период не хватает отпускных дней.")
			return
		}

		var id, status string
		if err := pool.QueryRow(r.Context(), `
			INSERT INTO absence_requests (profile_id, start_on, end_on, days)
			VALUES ($1, $2::date, $3::date, $4)
			RETURNING id::text, status`,
			profile, body.Start, body.End, days).Scan(&id, &status); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка записи")
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"id": id, "start": body.Start, "end": body.End, "days": days, "status": status,
		})
	}
}

func settings(ctx context.Context, pool *pgxpool.Pool, profile string) (int, int, error) {
	var vacationDays, noticeDays int
	err := pool.QueryRow(ctx,
		`SELECT vacation_days, vacation_notice_days FROM absence_settings WHERE profile_id = $1`,
		profile).Scan(&vacationDays, &noticeDays)
	return vacationDays, noticeDays, err
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
	user := getenv("PGUSER", "hr_absences")
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
