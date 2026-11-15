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

	"github.com/dureppa/ai-buddy/tools/shared"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const schema = `
CREATE TABLE IF NOT EXISTS document_items (
    id         text PRIMARY KEY,
    title      text NOT NULL,
    body       text NOT NULL,
    sort_order integer NOT NULL
);
CREATE TABLE IF NOT EXISTS document_marks (
    profile_id text NOT NULL,
    item_id    text NOT NULL REFERENCES document_items (id),
    done       boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, item_id)
);`

const seed = `
INSERT INTO document_items (id, title, body, sort_order) VALUES
    ('papers', 'Оформление в первый день', 'Сверь комплект документов с куратором и отметь, что памятка прочитана.', 1),
    ('rules', 'Правила первого дня', 'Коротко: куда прийти, кого найти и какие документы подписать.', 2),
    ('sign', 'Подписание документов', 'После согласования куратор подскажет, где подписать документы и как проверить статус.', 3)
ON CONFLICT (id) DO NOTHING;`

func main() {
	loadEnv()
	addr := getenv("HTTP_ADDR", ":8187")
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
	sessions := shared.Sessions{Secret: []byte(demoSecret), Audience: "hr-documents", Demo: isDemo}
	mux.HandleFunc("POST /api/v1/demo/sessions", sessions.Login)
	auth := func(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
		return sessions.WithDemoSession(next, requireAuth(secret, next))
	}

	mux.HandleFunc("GET /api/v1/me/documents", auth(handleList(pool)))
	mux.HandleFunc("PUT /api/v1/me/documents/{id}", auth(handleSet(pool)))

	slog.Info("hr-documents слушает", "addr", addr, "db", os.Getenv("PGDATABASE"))
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("сервер остановлен", "error", err)
		os.Exit(1)
	}
}

func handleList(pool *pgxpool.Pool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, profile string) {
		rows, err := pool.Query(r.Context(), `
			SELECT i.id, i.title, i.body, coalesce(m.done, false), m.updated_at
			FROM document_items i
			LEFT JOIN document_marks m ON m.item_id = i.id AND m.profile_id = $1
			ORDER BY i.sort_order`, profile)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		defer rows.Close()

		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, title, text string
			var done bool
			var updatedAt *time.Time
			if err := rows.Scan(&id, &title, &text, &done, &updatedAt); err != nil {
				fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
				return
			}
			out = append(out, map[string]any{
				"id": id, "title": title, "text": text, "done": done, "updated_at": updatedAt,
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
			Done *bool `json:"done"`
		}
		if err := readBody(w, r, &body); err != nil || body.Done == nil {
			fail(w, http.StatusBadRequest, "invalid_input", "нужно поле done")
			return
		}
		id := r.PathValue("id")

		var known bool
		err := pool.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM document_items WHERE id = $1)`, id).Scan(&known)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка чтения")
			return
		}
		if !known {
			fail(w, http.StatusBadRequest, "invalid_input", "Запись не найдена.")
			return
		}

		_, err = pool.Exec(r.Context(), `
			INSERT INTO document_marks (profile_id, item_id, done) VALUES ($1, $2, $3)
			ON CONFLICT (profile_id, item_id)
			DO UPDATE SET done = EXCLUDED.done, updated_at = now() WHERE document_marks.done IS DISTINCT FROM EXCLUDED.done`,
			profile, id, *body.Done)
		if err != nil {
			fail(w, http.StatusInternalServerError, "internal", "ошибка записи")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "done": body.Done})
	}
}

func ensureCluster(ctx context.Context) error {
	user := getenv("PGUSER", "hr_documents")
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
