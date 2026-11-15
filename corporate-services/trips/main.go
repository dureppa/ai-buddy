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
	"strconv"
	"strings"
	"time"

	"github.com/dureppa/ai-buddy/tools/shared"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const travelNoticeDays = 10

const schema = `
CREATE TABLE IF NOT EXISTS trip_settings (
    profile_id     text PRIMARY KEY,
    travel_enabled boolean NOT NULL DEFAULT true,
    travel_budget  integer NOT NULL DEFAULT 0 CHECK (travel_budget >= 0)
);
CREATE TABLE IF NOT EXISTS trip_destinations (
    id          text PRIMARY KEY,
    title       text NOT NULL,
    description text NOT NULL,
    estimate    integer NOT NULL CHECK (estimate > 0)
);
CREATE TABLE IF NOT EXISTS trip_requests (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  text NOT NULL,
    destination text NOT NULL REFERENCES trip_destinations (id),
    travel_date date NOT NULL,
    budget      integer NOT NULL CHECK (budget > 0),
    status      text NOT NULL DEFAULT 'pending',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_requests_profile_idx
    ON trip_requests (profile_id, created_at DESC);`

const seed = `
INSERT INTO trip_settings (profile_id, travel_enabled, travel_budget) VALUES
    ('olga',  false, 0),
    ('sasha', true,  35000),
    ('maria', true,  65000),
    ('timur', false, 0)
ON CONFLICT (profile_id) DO NOTHING;
INSERT INTO trip_destinations (id, title, description, estimate) VALUES
    ('kazan',        'Казань',          'Встреча продуктовой команды',     18000),
    ('petersburg',   'Санкт-Петербург', 'Исследовательский выезд',         26000),
    ('ekaterinburg', 'Екатеринбург',    'Встреча с региональной командой', 34000)
ON CONFLICT (id) DO NOTHING;`

func main() {
	loadEnv()
	addr := getenv("HTTP_ADDR", ":8183")
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
	sessions := shared.Sessions{Secret: []byte(demoSecret), Audience: "hr-trips", Demo: isDemo}
	mux.HandleFunc("POST /api/v1/demo/sessions", sessions.Login)
	auth := func(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
		return sessions.WithDemoSession(next, requireAuth(secret, next))
	}

	mux.HandleFunc("GET /api/v1/me/travel-summary", auth(handleSummary(pool)))
	mux.HandleFunc("POST /api/v1/me/trip-requests", auth(handleCreate(pool)))

	slog.Info("hr-trips слушает", "addr", addr, "db", os.Getenv("PGDATABASE"))
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("сервер остановлен", "error", err)
		os.Exit(1)
	}
}

func handleSummary(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		enabled, budget, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}

		destRows, err := pool.Query(r.Context(),
			`SELECT id, title, description, estimate FROM trip_destinations ORDER BY id`)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer destRows.Close()

		destinations := make([]map[string]any, 0)
		for destRows.Next() {
			var id, title, description string
			var estimate int
			if err := destRows.Scan(&id, &title, &description, &estimate); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			destinations = append(destinations, map[string]any{
				"id": id, "title": title, "description": description, "estimate": estimate,
			})
		}

		reqRows, err := pool.Query(r.Context(), `
			SELECT id::text, destination, travel_date::text, budget, status
			FROM trip_requests
			WHERE profile_id = $1
			ORDER BY created_at DESC`, profile)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer reqRows.Close()

		requests := make([]map[string]any, 0)
		for reqRows.Next() {
			var id, destination, date, status string
			var amount int
			if err := reqRows.Scan(&id, &destination, &date, &amount, &status); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			requests = append(requests, map[string]any{
				"id": id, "destination": destination, "date": date, "budget": amount, "status": status,
			})
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"travel_enabled":     enabled,
			"travel_budget":      budget,
			"travel_notice_days": travelNoticeDays,
			"earliest_trip":      addDays(today(), travelNoticeDays),
			"destinations":       destinations,
			"requests":           requests,
		})
	}
}

func handleCreate(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		var body struct {
			Destination string      `json:"destination"`
			Date        string      `json:"date"`
			Budget      json.Number `json:"budget"`
		}
		if err := readBody(w, r, &body); err != nil {
			fail(w, http.StatusBadRequest, "invalid_input", "нужны поля destination, date и budget")
			return
		}

		enabled, travelBudget, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}
		if !enabled {
			fail(w, http.StatusBadRequest, "invalid_input", "Для твоего профиля поездки пока недоступны.")
			return
		}

		todayStr := today()
		var upcoming bool
		if err := pool.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM trip_requests WHERE profile_id = $1 AND travel_date >= $2::date)`,
			profile, todayStr).Scan(&upcoming); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if upcoming {
			fail(w, http.StatusBadRequest, "invalid_input", "У тебя уже есть заявка на предстоящую поездку.")
			return
		}

		var estimate int
		err = pool.QueryRow(r.Context(),
			`SELECT estimate FROM trip_destinations WHERE id = $1`, body.Destination).Scan(&estimate)
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, http.StatusBadRequest, "invalid_input", "Выбери город и дату с учётом срока подачи.")
			return
		}
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if _, perr := time.Parse("2006-01-02", body.Date); perr != nil || body.Date < addDays(todayStr, travelNoticeDays) {
			fail(w, http.StatusBadRequest, "invalid_input", "Выбери город и дату с учётом срока подачи.")
			return
		}

		budgetInt, aerr := strconv.Atoi(body.Budget.String())
		if aerr != nil || budgetInt < estimate || budgetInt > travelBudget {
			fail(w, http.StatusBadRequest, "invalid_input", "Укажи смету от оценки поездки до своего лимита.")
			return
		}

		var id, status string
		if err := pool.QueryRow(r.Context(), `
			INSERT INTO trip_requests (profile_id, destination, travel_date, budget)
			VALUES ($1, $2, $3::date, $4)
			RETURNING id::text, status`,
			profile, body.Destination, body.Date, budgetInt).Scan(&id, &status); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка записи")
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"id": id, "destination": body.Destination, "date": body.Date,
			"budget": budgetInt, "status": status,
		})
	}
}

func settings(ctx context.Context, pool *pgxpool.Pool, profile string) (bool, int, error) {
	var enabled bool
	var budget int
	err := pool.QueryRow(ctx,
		`SELECT travel_enabled, travel_budget FROM trip_settings WHERE profile_id = $1`,
		profile).Scan(&enabled, &budget)
	return enabled, budget, err
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
	user := getenv("PGUSER", "hr_trips")
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
