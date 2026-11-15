package config

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestParseLine(t *testing.T) {
	tests := []struct {
		line  string
		key   string
		value string
		ok    bool
	}{
		{"PGUSER=aibuddy", "PGUSER", "aibuddy", true},
		{"  export PGPORT = 5433 ", "PGPORT", "5433", true},
		{`PGPASSWORD="p a#ss"`, "PGPASSWORD", "p a#ss", true},
		{"PGDATABASE=aibuddy # комментарий", "PGDATABASE", "aibuddy", true},
		{"# комментарий", "", "", false},
		{"", "", "", false},
		{"строка без равно", "", "", false},
		{"=значение", "", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.line, func(t *testing.T) {
			k, v, ok := parseLine(tt.line)
			require.Equal(t, tt.ok, ok)
			require.Equal(t, tt.key, k)
			require.Equal(t, tt.value, v)
		})
	}
}

func TestLoadDotEnvKeepsRealEnv(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := "BUDDY_TEST_A=fromfile\nBUDDY_TEST_B=5433\n"
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))

	t.Setenv("ENV_FILE", path)
	t.Setenv("BUDDY_TEST_A", "fromenv")
	t.Cleanup(func() { _ = os.Unsetenv("BUDDY_TEST_B") })

	require.NoError(t, loadDotEnv())
	require.Equal(t, "fromenv", os.Getenv("BUDDY_TEST_A"))
	require.Equal(t, "5433", os.Getenv("BUDDY_TEST_B"))
}

func TestBuildURLEscapesPassword(t *testing.T) {
	t.Setenv("PGUSER", "aibuddy")
	t.Setenv("PGPASSWORD", "p@ss:word/?#")
	t.Setenv("PGHOST", "localhost")
	t.Setenv("PGPORT", "5432")
	t.Setenv("PGSSLMODE", "disable")

	dsn, err := buildURL("aibuddy")
	require.NoError(t, err)

	u, err := url.Parse(dsn)
	require.NoError(t, err)
	require.Equal(t, "aibuddy", u.User.Username())
	pass, _ := u.User.Password()
	require.Equal(t, "p@ss:word/?#", pass)
	require.Equal(t, "/aibuddy", u.Path)
	require.Equal(t, "disable", u.Query().Get("sslmode"))
}

func TestBuildURLRequiresUserAndDatabase(t *testing.T) {
	t.Setenv("PGUSER", "")
	_, err := buildURL("aibuddy")
	require.Error(t, err)
}
func setupLoadEnv(t *testing.T) {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".env")
	require.NoError(t, os.WriteFile(path, []byte(""), 0o600))
	t.Setenv("ENV_FILE", path)
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PGUSER", "aibuddy")
	t.Setenv("PGPASSWORD", "pass")
	t.Setenv("PGDATABASE", "aibuddy")
	t.Setenv("SESSION_SECRET", strings.Repeat("k", 32))
	t.Setenv("SESSION_TTL", "24h")
}

func TestLoadSuccess(t *testing.T) {
	setupLoadEnv(t)
	t.Setenv("HTTP_ADDR", ":9090")
	t.Setenv("SESSION_TTL", "1h")
	t.Setenv("DEMO_MODE", "true")
	t.Setenv("CORPORATE_MOCK_FAIL", "true")

	cfg, err := Load()
	require.NoError(t, err)
	require.Equal(t, ":9090", cfg.Addr)
	require.Equal(t, time.Hour, cfg.SessionTTL)
	require.True(t, cfg.DemoMode)
	require.True(t, cfg.CorporateFail)
	require.Contains(t, cfg.DatabaseURL, "aibuddy")
}

func TestLoadDefaults(t *testing.T) {
	setupLoadEnv(t)
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("DEMO_MODE", "")
	t.Setenv("CORPORATE_MOCK_FAIL", "")

	cfg, err := Load()
	require.NoError(t, err)
	require.Equal(t, ":8080", cfg.Addr)
	require.Equal(t, 24*time.Hour, cfg.SessionTTL)
	require.False(t, cfg.DemoMode)
	require.False(t, cfg.CorporateFail)
}

func TestLoadUsesDatabaseURL(t *testing.T) {
	setupLoadEnv(t)
	t.Setenv("DATABASE_URL", "postgres://u:p@h:5432/db?sslmode=disable")

	cfg, err := Load()
	require.NoError(t, err)
	require.Equal(t, "postgres://u:p@h:5432/db?sslmode=disable", cfg.DatabaseURL)
}

func TestLoadErrors(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
	}{
		{"короткий секрет", map[string]string{"SESSION_SECRET": "short"}},
		{"пустой секрет", map[string]string{"SESSION_SECRET": ""}},
		{"битый TTL", map[string]string{"SESSION_TTL": "abc"}},
		{"нулевой TTL", map[string]string{"SESSION_TTL": "0s"}},
		{"отрицательный TTL", map[string]string{"SESSION_TTL": "-1h"}},
		{"нет PGUSER", map[string]string{"PGUSER": ""}},
		{"нет PGDATABASE", map[string]string{"PGDATABASE": ""}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupLoadEnv(t)
			for k, v := range tt.env {
				t.Setenv(k, v)
			}
			_, err := Load()
			require.Error(t, err)
		})
	}
}

func TestLoadMissingEnvFile(t *testing.T) {
	t.Setenv("ENV_FILE", filepath.Join(t.TempDir(), "нет-такого"))
	_, err := Load()
	require.Error(t, err)
}

func TestTestDatabaseURLUsesDedicatedConfiguration(t *testing.T) {
	setupLoadEnv(t)
	const explicit = "postgres://test@localhost/isolated"
	t.Setenv("TEST_DATABASE_URL", explicit)
	require.Equal(t, explicit, TestDatabaseURL())

	t.Setenv("TEST_DATABASE_URL", "")
	t.Setenv("TEST_PGDATABASE", "isolated")
	t.Setenv("PGPASSWORD", "")
	t.Setenv("PGHOST", "::1")
	t.Setenv("PGPORT", "5544")
	t.Setenv("PGSSLMODE", "require")
	require.Equal(t, "postgres://aibuddy@[::1]:5544/isolated?sslmode=require", TestDatabaseURL())

	t.Setenv("TEST_PGDATABASE", "")
	require.Empty(t, TestDatabaseURL())
	t.Setenv("ENV_FILE", filepath.Join(t.TempDir(), "missing"))
	require.Empty(t, TestDatabaseURL())
}

func TestDotEnvDiscoveryAndReadFailure(t *testing.T) {
	parent := t.TempDir()
	child := filepath.Join(parent, "child", "deep")
	require.NoError(t, os.MkdirAll(child, 0o700))
	path := filepath.Join(parent, ".env")
	require.NoError(t, os.WriteFile(path, nil, 0o600))
	t.Setenv("ENV_FILE", "")
	t.Chdir(child)
	found, err := findEnvFile()
	require.NoError(t, err)
	require.True(t, strings.HasSuffix(found, filepath.Join(filepath.Base(parent), ".env")), found)

	t.Setenv("ENV_FILE", child)
	require.ErrorContains(t, loadDotEnv(), "read")
	_, _, ok := parseLine("   =empty-key")
	require.False(t, ok)
}
