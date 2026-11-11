package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

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
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
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
	api := httpapi.NewAPI(sessions, onboarding, access)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
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
