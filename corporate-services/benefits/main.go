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
CREATE TABLE IF NOT EXISTS benefit_settings (
    profile_id         text PRIMARY KEY,
    benefit_budget     integer NOT NULL CHECK (benefit_budget >= 0),
    available_benefits text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS benefit_options (
    id          text PRIMARY KEY,
    title       text NOT NULL,
    description text NOT NULL,
    amount      integer NOT NULL CHECK (amount > 0)
);
CREATE TABLE IF NOT EXISTS benefit_requests (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id text NOT NULL,
    benefit_id text NOT NULL REFERENCES benefit_options (id),
    amount     integer NOT NULL CHECK (amount > 0),
    status     text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, benefit_id)
);
CREATE INDEX IF NOT EXISTS benefit_requests_profile_idx
    ON benefit_requests (profile_id, created_at DESC);`

const seed = `
INSERT INTO benefit_settings (profile_id, benefit_budget, available_benefits) VALUES
    ('olga',  6000,  '{learning}'),
    ('sasha', 12000, '{learning,sport}'),
    ('maria', 24000, '{learning,sport,wellbeing}')
ON CONFLICT (profile_id) DO NOTHING;
INSERT INTO benefit_options (id, title, description, amount) VALUES
    ('learning',  'Обучение',        'Курсы и профессиональные книги', 4500),
    ('sport',     'Спорт',           'Абонемент или занятия',          6000),
    ('wellbeing', 'Забота о себе',   'Консультации и восстановление',  7500)
ON CONFLICT (id) DO NOTHING;`

func main() {
	loadEnv()
	addr := getenv("HTTP_ADDR", ":8186")
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
	sessions := shared.Sessions{Secret: []byte(demoSecret), Audience: "hr-benefits", Demo: isDemo}
	mux.HandleFunc("POST /api/v1/demo/sessions", sessions.Login)
	auth := func(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
		return sessions.WithDemoSession(next, requireAuth(secret, next))
	}

	mux.HandleFunc("GET /api/v1/me/benefit-summary", auth(handleSummary(pool)))
	mux.HandleFunc("POST /api/v1/me/benefit-requests", auth(handleCreate(pool)))

	slog.Info("hr-benefits слушает", "addr", addr, "db", os.Getenv("PGDATABASE"))
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("сервер остановлен", "error", err)
		os.Exit(1)
	}
}

func handleSummary(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		budget, available, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}

		optRows, err := pool.Query(r.Context(),
			`SELECT id, title, description, amount FROM benefit_options ORDER BY id`)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer optRows.Close()

		options := make([]map[string]any, 0)
		for optRows.Next() {
			var id, title, description string
			var amount int
			if err := optRows.Scan(&id, &title, &description, &amount); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			options = append(options, map[string]any{
				"id": id, "title": title, "description": description,
				"amount": amount, "available": contains(available, id),
			})
		}

		reqRows, err := pool.Query(r.Context(), `
			SELECT id::text, benefit_id, amount, status
			FROM benefit_requests
			WHERE profile_id = $1
			ORDER BY created_at DESC`, profile)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer reqRows.Close()

		requests := make([]map[string]any, 0)
		spent := 0
		for reqRows.Next() {
			var id, benefit, status string
			var amount int
			if err := reqRows.Scan(&id, &benefit, &amount, &status); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			spent += amount
			requests = append(requests, map[string]any{
				"id": id, "benefit": benefit, "amount": amount, "status": status,
			})
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"benefit_budget": budget,
			"benefit_left":   budget - spent,
			"options":        options,
			"requests":       requests,
		})
	}
}

func handleCreate(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		var body struct {
			Benefit string `json:"benefit"`
		}
		if err := readBody(w, r, &body); err != nil {
			fail(w, http.StatusBadRequest, "invalid_input", "нужно поле benefit")
			return
		}

		var amount int
		err := pool.QueryRow(r.Context(),
			`SELECT amount FROM benefit_options WHERE id = $1`, body.Benefit).Scan(&amount)
		optionKnown := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}

		_, available, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}
		if !optionKnown || !contains(available, body.Benefit) {
			fail(w, http.StatusBadRequest, "invalid_input", "Эта программа недоступна для твоего профиля.")
			return
		}

		var duplicate bool
		if err := pool.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM benefit_requests WHERE profile_id = $1 AND benefit_id = $2)`,
			profile, body.Benefit).Scan(&duplicate); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if duplicate {
			fail(w, http.StatusBadRequest, "invalid_input", "По этой программе уже есть заявка.")
			return
		}

		budget, _, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}
		var spent int
		if err := pool.QueryRow(r.Context(),
			`SELECT coalesce(sum(amount), 0) FROM benefit_requests WHERE profile_id = $1`,
			profile).Scan(&spent); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if amount > budget-spent {
			fail(w, http.StatusBadRequest, "invalid_input", "Остатка бюджета не хватает на эту программу.")
			return
		}

		var id, status string
		if err := pool.QueryRow(r.Context(), `
			INSERT INTO benefit_requests (profile_id, benefit_id, amount)
			VALUES ($1, $2, $3)
			RETURNING id::text, status`,
			profile, body.Benefit, amount).Scan(&id, &status); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка записи")
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"id": id, "benefit": body.Benefit, "amount": amount, "status": status,
		})
	}
}

func settings(ctx context.Context, pool *pgxpool.Pool, profile string) (int, []string, error) {
	var budget int
	var available []string
	err := pool.QueryRow(ctx,
		`SELECT benefit_budget, available_benefits FROM benefit_settings WHERE profile_id = $1`,
		profile).Scan(&budget, &available)
	return budget, available, err
}

func contains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

func failSettings(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusNotFound, "not_found", "профиль не найден")
		return
	}
	fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
}

func ensureCluster(ctx context.Context) error {
	user := getenv("PGUSER", "hr_benefits")
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
