package main

import (
	"context"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestServerStartupShutdownAndAIWiring(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	t.Setenv("DATABASE_URL", dsn)
	t.Setenv("SESSION_SECRET", strings.Repeat("s", 32))
	t.Setenv("DEMO_MODE", "true")
	t.Setenv("AI_SERVICE_URL", "http://127.0.0.1:18001")
	t.Setenv("AI_SERVICE_TOKEN", "service-token-long")
	t.Setenv("MCP_ADAPTER_SERVICE_TOKEN", "adapter-token-long")
	t.Setenv("AI_DELEGATION_SECRET", strings.Repeat("d", 32))
	t.Setenv("HR_CONSENTS_URL", "")
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	addr := listener.Addr().String()
	require.NoError(t, listener.Close())
	t.Setenv("HTTP_ADDR", addr)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- runContext(ctx) }()
	client := &http.Client{Timeout: 100 * time.Millisecond}
	ready := false
	for attempt := 0; attempt < 100; attempt++ {
		res, e := client.Get("http://" + addr + "/api/v1/onboarding")
		if e == nil {
			require.Equal(t, 401, res.StatusCode)
			_ = res.Body.Close()
			ready = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	require.True(t, ready, "server did not become ready")
	cancel()
	require.NoError(t, <-done)
	t.Setenv("AI_DELEGATION_SECRET", strings.Repeat("s", 32))
	require.ErrorContains(t, runContext(context.Background()), "must differ")
	t.Setenv("AI_SERVICE_TOKEN", "")
	require.ErrorContains(t, runContext(context.Background()), "separate AI secrets")
}
func TestInvalidServerConfiguration(t *testing.T) {
	t.Setenv("SESSION_SECRET", "short")
	require.ErrorContains(t, runContext(context.Background()), "config")
	t.Setenv("SESSION_SECRET", strings.Repeat("s", 32))
	t.Setenv("DATABASE_URL", ":bad")
	require.Error(t, runContext(context.Background()))
	t.Setenv("DATABASE_URL", "postgres://postgres@127.0.0.1:1/test?connect_timeout=1")
	require.ErrorContains(t, runContext(context.Background()), "ping postgres")
}
