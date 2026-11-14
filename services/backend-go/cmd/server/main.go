package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/ai"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/config"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/httpapi"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("сервер остановлен", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runContext(ctx)
}

func runContext(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	poolConfig, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("parse postgres config: %w", err)
	}
	poolConfig.MaxConns = max(4, poolConfig.MaxConns)
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return fmt.Errorf("pgx pool: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping postgres: %w", err)
	}

	st := store.New(pool)
	tokens := buddy.NewTokens(cfg.SessionSecret, cfg.SessionTTL)
	onboarding := buddy.NewOnboarding(st)
	sessions := buddy.NewSessions(st, tokens, cfg.DemoMode)
	corp := store.NewCorporate(pool, cfg.CorporateFail)
	access := buddy.NewAccess(st, corp)
	notifications := buddy.NewNotifications(st)
	chat := buddy.NewChat(buddy.UnavailableAssistant{})
	var bridge *ai.Bridge
	if os.Getenv("AI_SERVICE_URL") != "" {
		bridge, err = ai.New(st, os.Getenv("AI_SERVICE_URL"), os.Getenv("AI_SERVICE_TOKEN"), os.Getenv("MCP_ADAPTER_SERVICE_TOKEN"), os.Getenv("AI_DELEGATION_SECRET"), os.Getenv("HR_CONSENTS_URL"))
		if err != nil {
			return err
		}
		if err = ai.OriginOK(os.Getenv("HR_DOCUMENTS_URL")); err != nil {
			return err
		}
		if err = ai.OriginOK(os.Getenv("HR_EVENTS_URL")); err != nil {
			return err
		}
		bridge.DocumentsURL = strings.TrimRight(os.Getenv("HR_DOCUMENTS_URL"), "/")
		bridge.EventsURL = strings.TrimRight(os.Getenv("HR_EVENTS_URL"), "/")
		if bridge.Secret == cfg.SessionSecret {
			return fmt.Errorf("AI delegation and session secrets must differ")
		}
		if publicURL := os.Getenv("HR_CONSENTS_PUBLIC_URL"); publicURL != "" {
			if err = setPublicURL(&bridge.PublicConsentURL, publicURL); err != nil {
				return err
			}
		}
		if publicURL := os.Getenv("HR_DOCUMENTS_PUBLIC_URL"); publicURL != "" {
			if err = setPublicURL(&bridge.PublicDocumentsURL, publicURL); err != nil {
				return err
			}
		}
		if publicURL := os.Getenv("HR_EVENTS_PUBLIC_URL"); publicURL != "" {
			if err = setPublicURL(&bridge.PublicEventsURL, publicURL); err != nil {
				return err
			}
		}
		bridge.HRSecret = cfg.SessionSecret
		bridge.DemoMode = cfg.DemoMode
		chat = buddy.NewChat(bridge)
	}
	api := httpapi.NewAPI(sessions, onboarding, access, notifications, chat)

	if bridge != nil {
		api.WithInternalRoutes(bridge.Register).WithTeamGuide(st)
		workerCtx, cancelWorker := context.WithCancel(ctx)
		done := make(chan struct{})
		go func() {
			defer close(done)
			runTeamGuideWorker(workerCtx, st, bridge)
		}()
		defer func() {
			cancelWorker()
			<-done
		}()
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      35 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	slog.Info("сервер слушает", "addr", cfg.Addr, "demo_mode", cfg.DemoMode)

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func setPublicURL(target *string, publicURL string) error {
	u, err := url.Parse(publicURL)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("invalid public service URL")
	}
	*target = strings.TrimRight(publicURL, "/") + "/"
	return nil
}
