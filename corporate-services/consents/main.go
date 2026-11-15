package main

import (
	"context"
	"encoding/json"
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
CREATE TABLE IF NOT EXISTS consent_purposes (
    id          text PRIMARY KEY,
    title       text NOT NULL,
    description text NOT NULL,
    sort_order  integer NOT NULL
);
CREATE TABLE IF NOT EXISTS consents (
    profile_id text NOT NULL,
    purpose    text NOT NULL REFERENCES consent_purposes (id),
    granted    boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, purpose)
);`

const seed = `
INSERT INTO consent_purposes (id, title, description, sort_order) VALUES
    ('news',   'Внутренние новости', 'Письма о событиях и обучении.',          1),
    ('photos', 'Фото с мероприятий', 'Публикация фото во внутренних каналах.', 2)
ON CONFLICT (id) DO NOTHING;
INSERT INTO consents (profile_id, purpose, granted) VALUES
    ('olga', 'news', true), ('sasha', 'photos', true),
    ('maria', 'news', true), ('maria', 'photos', true)
ON CONFLICT (profile_id, purpose) DO NOTHING;`

func main() {
	loadEnv()
	addr := getenv("HTTP_ADDR", ":8185")
	secret := os.Getenv("SESSION_SECRET")
	if secret == "" {
		slog.Error("SESSION_SECRET не задан: возьми его из web/backend/.env")
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
	mux.HandleFunc("GET /api/v1/me/consents", requireAuth(secret, handleList(pool)))
	mux.HandleFunc("PUT /api/v1/me/consents/{purpose}", requireAuth(secret, handleSet(pool)))

	slog.Info("hr-consents слушает", "addr", addr, "db", os.Getenv("PGDATABASE"))
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("сервер остановлен", "error", err)
		os.Exit(1)
	}
}

func handleList(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		rows, err := pool.Query(r.Context(), `
			SELECT p.id, p.title, p.description, coalesce(c.granted, false),c.updated_at
			FROM consent_purposes p
			LEFT JOIN consents c ON c.purpose = p.id AND c.profile_id = $1
			ORDER BY p.sort_order`, profile)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer rows.Close()

		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, title, description string
			var granted bool
			var updatedAt *time.Time
			if err := rows.Scan(&id, &title, &description, &granted, &updatedAt); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			out = append(out, map[string]any{
				"updated_at": updatedAt, "purpose": id, "title": title, "description": description, "granted": granted,
			})
		}
		if rows.Err() != nil {
			fail(w, 500, "internal", "ошибка чтения")
			return
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func handleSet(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		var body struct {
			Granted *bool `json:"granted"`
		}
		if err := readBody(w, r, &body); err != nil || body.Granted == nil {
			fail(w, http.StatusBadRequest, "invalid_input", "нужно поле granted")
			return
		}
		purpose := r.PathValue("purpose")

		var known bool
		err := pool.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM consent_purposes WHERE id = $1)`, purpose).Scan(&known)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if !known {
			fail(w, http.StatusBadRequest, "invalid_input", "это согласие нельзя изменить")
			return
		}

		_, err = pool.Exec(r.Context(), `
			INSERT INTO consents (profile_id, purpose, granted) VALUES ($1, $2, $3)
			ON CONFLICT (profile_id, purpose)
			DO UPDATE SET granted = EXCLUDED.granted, updated_at = now() WHERE consents.granted IS DISTINCT FROM EXCLUDED.granted`,
			profile, purpose, *body.Granted)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка записи")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"purpose": purpose, "granted": body.Granted})
	}
}

// ensureCluster создаёт роль и базу из .env, если их ещё нет.
// Роль может создать только суперпользователь, поэтому подключение идёт под
// PGADMIN_USER, а работает сервис уже под PGUSER.
func ensureCluster(ctx context.Context) error {
	user := getenv("PGUSER", "hr_consents")
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

// requireAuth проверяет токен ядра AI Buddy и передаёт profile_id в хендлер.
// Проверка stateless: своей таблицы сессий у сервиса нет.
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
