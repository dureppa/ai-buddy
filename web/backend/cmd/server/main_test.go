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

func TestServerIntegrationConfiguration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	for key, value := range map[string]string{
		"DATABASE_URL": dsn, "SESSION_SECRET": strings.Repeat("s", 32), "DEMO_MODE": "true",
		"AI_SERVICE_URL": "http://localhost:18001", "AI_SERVICE_TOKEN": "service-token-long",
		"MCP_ADAPTER_SERVICE_TOKEN": "adapter-token-long", "AI_DELEGATION_SECRET": strings.Repeat("d", 32),
		"ACCESS_DELEGATION_SECRET": strings.Repeat("a", 32), "CONFLUENCE_DELEGATION_SECRET": strings.Repeat("c", 32),
		"WORK_TOOLS_ENABLED": "true", "WORK_TOOLS_EXTERNAL": "true",
		"WORK_TOOL_DELEGATION_SECRET": strings.Repeat("w", 32),
	} {
		t.Setenv(key, value)
	}
	for _, key := range []string{
		"ACCESS_API_URL", "CONFLUENCE_API_URL", "WORK_TOOLS_PUBLIC_URL",
		"ACCESS_PUBLIC_URL", "CONFLUENCE_PUBLIC_URL", "HR_CONSENTS_PUBLIC_URL",
		"HR_DOCUMENTS_PUBLIC_URL", "HR_EVENTS_PUBLIC_URL", "JIRA_PUBLIC_URL",
	} {
		t.Setenv(key, "http://localhost:18002/")
	}
	for _, tt := range []struct{ key, value, message string }{
		{"ACCESS_API_URL", "file:///tmp", "ACCESS_API_URL"},
		{"CONFLUENCE_API_URL", "file:///tmp", "CONFLUENCE_API_URL"},
		{"ACCESS_PUBLIC_URL", "file:///tmp", "invalid public service URL"},
		{"CONFLUENCE_PUBLIC_URL", "file:///tmp", "invalid public service URL"},
		{"HR_DOCUMENTS_URL", "file:///tmp", "invalid AI/HR origin"},
		{"HR_EVENTS_URL", "file:///tmp", "invalid AI/HR origin"},
		{"HR_ABSENCES_URL", "file:///tmp", "invalid AI/HR origin"},
		{"HR_CONSENTS_PUBLIC_URL", "file:///tmp", "invalid public service URL"},
		{"HR_DOCUMENTS_PUBLIC_URL", "file:///tmp", "invalid public service URL"},
		{"HR_EVENTS_PUBLIC_URL", "file:///tmp", "invalid public service URL"},
		{"JIRA_PUBLIC_URL", "file:///tmp", "service actions"},
		{"HR_HIRING_URL", "file:///tmp", "service actions"},
		{"WORK_TOOLS_PUBLIC_URL", "file:///tmp", "WORK_TOOLS_PUBLIC_URL"},
	} {
		t.Run(tt.key, func(t *testing.T) {
			t.Setenv(tt.key, tt.value)
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			require.ErrorContains(t, runContext(ctx), tt.message)
		})
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	t.Setenv("HTTP_ADDR", listener.Addr().String())
	for _, external := range []string{"true", "false"} {
		t.Run("external work tools "+external, func(t *testing.T) {
			t.Setenv("WORK_TOOLS_EXTERNAL", external)
			if external == "false" {
				t.Setenv("CONFLUENCE_API_URL", "")
			}
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			require.ErrorContains(t, runContext(ctx), "address already in use")
		})
	}
}
