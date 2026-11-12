package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	Addr          string
	DatabaseURL   string
	SessionSecret string
	SessionTTL    time.Duration
	DemoMode      bool
	CorporateFail bool
}

func Load() (Config, error) {
	if err := loadDotEnv(); err != nil {
		return Config{}, err
	}
	dsn, err := DatabaseURL()
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		Addr:          getenv("HTTP_ADDR", ":8080"),
		DatabaseURL:   dsn,
		SessionSecret: os.Getenv("SESSION_SECRET"),
		DemoMode:      os.Getenv("DEMO_MODE") == "true",
		CorporateFail: os.Getenv("CORPORATE_MOCK_FAIL") == "true"}
	if len(cfg.SessionSecret) < 32 {
		return Config{}, fmt.Errorf("SESSION_SECRET должен быть не короче 32 символов")
	}
	ttl, err := time.ParseDuration(getenv("SESSION_TTL", "24h"))
	if err != nil || ttl <= 0 {
		return Config{}, fmt.Errorf("SESSION_TTL: некорректная длительность")
	}
	cfg.SessionTTL = ttl
	return cfg, nil
}

// DatabaseURL берёт готовый DATABASE_URL или собирает его из PG*.
func DatabaseURL() (string, error) {
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v, nil
	}
	return buildURL(os.Getenv("PGDATABASE"))
}

// TestDatabaseURL возвращает DSN тестовой базы или пустую строку.
func TestDatabaseURL() string {
	if err := loadDotEnv(); err != nil {
		return ""
	}
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	dsn, err := buildURL(os.Getenv("TEST_PGDATABASE"))
	if err != nil {
		return ""
	}
	return dsn
}

func buildURL(database string) (string, error) {
	user := os.Getenv("PGUSER")
	if user == "" || database == "" {
		return "", fmt.Errorf("задай DATABASE_URL или PGUSER и PGDATABASE в .env")
	}
	u := &url.URL{
		Scheme:   "postgres",
		Host:     net.JoinHostPort(getenv("PGHOST", "localhost"), getenv("PGPORT", "5432")),
		Path:     "/" + database,
		RawQuery: url.Values{"sslmode": []string{getenv("PGSSLMODE", "disable")}}.Encode(),
	}
	if pass := os.Getenv("PGPASSWORD"); pass != "" {
		u.User = url.UserPassword(user, pass)
	} else {
		u.User = url.User(user)
	}
	return u.String(), nil
}

// loadDotEnv ищет .env от текущего каталога вверх и не переопределяет
// уже заданные переменные окружения.
func loadDotEnv() error {
	path, err := findEnvFile()
	if err != nil || path == "" {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := parseLine(line)
		if !ok {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("set %s: %w", key, err)
		}
	}
	return nil
}

func findEnvFile() (string, error) {
	if p := os.Getenv("ENV_FILE"); p != "" {
		if _, err := os.Stat(p); err != nil {
			return "", fmt.Errorf("ENV_FILE %s: %w", p, err)
		}
		return p, nil
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getwd: %w", err)
	}
	for {
		p := filepath.Join(dir, ".env")
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", nil
		}
		dir = parent
	}
}

func parseLine(line string) (string, string, bool) {
	s := strings.TrimSpace(line)
	if s == "" || strings.HasPrefix(s, "#") {
		return "", "", false
	}
	s = strings.TrimSpace(strings.TrimPrefix(s, "export "))
	i := strings.Index(s, "=")
	if i <= 0 {
		return "", "", false
	}
	key := strings.TrimSpace(s[:i])
	value := strings.TrimSpace(s[i+1:])
	if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
		value = value[1 : len(value)-1]
	} else if j := strings.Index(value, " #"); j >= 0 {
		value = strings.TrimSpace(value[:j])
	}
	if key == "" {
		return "", "", false
	}
	return key, value, true
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
