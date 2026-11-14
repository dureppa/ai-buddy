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
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const schema = `
CREATE TABLE IF NOT EXISTS hiring_settings (
    profile_id     text PRIMARY KEY,
    referral_slots integer NOT NULL CHECK (referral_slots >= 0)
);
CREATE TABLE IF NOT EXISTS hiring_vacancies (
    id          text PRIMARY KEY,
    title       text NOT NULL,
    description text NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_requests (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id text NOT NULL,
    vacancy_id text NOT NULL REFERENCES hiring_vacancies (id),
    name       text NOT NULL,
    email      text NOT NULL,
    status     text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, vacancy_id, email)
);
CREATE INDEX IF NOT EXISTS referral_requests_profile_idx
    ON referral_requests (profile_id, created_at DESC);`

const seed = `
INSERT INTO hiring_settings (profile_id, referral_slots) VALUES
    ('olga', 1), ('sasha', 2), ('maria', 3)
ON CONFLICT (profile_id) DO NOTHING;
INSERT INTO hiring_vacancies (id, title, description) VALUES
    ('design',   'Продуктовый дизайнер',  'Дизайн продукта · Москва'),
    ('frontend', 'Frontend-разработчик',  'Веб-платформа · Удалённо'),
    ('analyst',  'Продуктовый аналитик',  'Аналитика · Москва')
ON CONFLICT (id) DO NOTHING;`

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
	mux.HandleFunc("GET /api/v1/me/referral-summary", requireAuth(secret, handleSummary(pool)))
	mux.HandleFunc("POST /api/v1/me/referrals", requireAuth(secret, handleCreate(pool)))

	slog.Info("hr-hiring слушает", "addr", addr, "db", os.Getenv("PGDATABASE"))
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("сервер остановлен", "error", err)
		os.Exit(1)
	}
}

func handleSummary(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		slots, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}

		vacRows, err := pool.Query(r.Context(),
			`SELECT id, title, description FROM hiring_vacancies ORDER BY id`)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer vacRows.Close()

		vacancies := make([]map[string]any, 0)
		for vacRows.Next() {
			var id, title, description string
			if err := vacRows.Scan(&id, &title, &description); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			vacancies = append(vacancies, map[string]any{
				"id": id, "title": title, "description": description,
			})
		}

		refRows, err := pool.Query(r.Context(), `
			SELECT id::text, vacancy_id, name, email, status
			FROM referral_requests
			WHERE profile_id = $1
			ORDER BY created_at DESC`, profile)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer refRows.Close()

		referrals := make([]map[string]any, 0)
		for refRows.Next() {
			var id, vacancy, name, email, status string
			if err := refRows.Scan(&id, &vacancy, &name, &email, &status); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			referrals = append(referrals, map[string]any{
				"id": id, "vacancy": vacancy, "name": name, "email": email, "status": status,
			})
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"referral_slots": slots,
			"referral_left":  slots - len(referrals),
			"vacancies":      vacancies,
			"referrals":      referrals,
		})
	}
}

func handleCreate(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		var body struct {
			Vacancy string `json:"vacancy"`
			Name    string `json:"name"`
			Email   string `json:"email"`
		}
		if err := readBody(w, r, &body); err != nil {
			fail(w, http.StatusBadRequest, "invalid_input", "нужны поля vacancy, name и email")
			return
		}

		name := strings.TrimSpace(body.Name)
		email := strings.ToLower(strings.TrimSpace(body.Email))

		var vacancyKnown bool
		if err := pool.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM hiring_vacancies WHERE id = $1)`, body.Vacancy).Scan(&vacancyKnown); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		nameLen := utf8.RuneCountInString(name)
		if !vacancyKnown || nameLen < 2 || nameLen > 100 || !validEmail(email) {
			fail(w, http.StatusBadRequest, "invalid_input", "Проверь вакансию, имя и почту кандидата.")
			return
		}

		var duplicate bool
		if err := pool.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM referral_requests
				WHERE profile_id = $1 AND vacancy_id = $2 AND email = $3)`,
			profile, body.Vacancy, email).Scan(&duplicate); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if duplicate {
			fail(w, http.StatusBadRequest, "invalid_input", "Такая рекомендация уже есть.")
			return
		}

		slots, err := settings(r.Context(), pool, profile)
		if err != nil {
			failSettings(w, err)
			return
		}
		var used int
		if err := pool.QueryRow(r.Context(),
			`SELECT count(*) FROM referral_requests WHERE profile_id = $1`, profile).Scan(&used); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if slots-used <= 0 {
			fail(w, http.StatusBadRequest, "invalid_input", "Лимит рекомендаций исчерпан.")
			return
		}

		var id, status string
		if err := pool.QueryRow(r.Context(), `
			INSERT INTO referral_requests (profile_id, vacancy_id, name, email)
			VALUES ($1, $2, $3, $4)
			RETURNING id::text, status`,
			profile, body.Vacancy, name, email).Scan(&id, &status); err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка записи")
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"id": id, "vacancy": body.Vacancy, "name": name, "email": email, "status": status,
		})
	}
}

func validEmail(e string) bool {
	at := strings.Index(e, "@")
	if at <= 0 || at != strings.LastIndex(e, "@") {
		return false
	}
	local, domain := e[:at], e[at+1:]
	if local == "" || strings.ContainsAny(local, " \t") {
		return false
	}
	dot := strings.LastIndex(domain, ".")
	if dot <= 0 || dot == len(domain)-1 {
		return false
	}
	if strings.ContainsAny(domain, " \t") {
		return false
	}
	return true
}

func settings(ctx context.Context, pool *pgxpool.Pool, profile string) (int, error) {
	var slots int
	err := pool.QueryRow(ctx,
		`SELECT referral_slots FROM hiring_settings WHERE profile_id = $1`, profile).Scan(&slots)
	return slots, err
}

func failSettings(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusNotFound, "not_found", "профиль не найден")
		return
	}
	fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
}

func ensureCluster(ctx context.Context) error {
	user := getenv("PGUSER", "hr_hiring")
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
