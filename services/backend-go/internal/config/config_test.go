package config

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"

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
