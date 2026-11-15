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
	"github.com/dureppa/ai-buddy/services/backend-go/internal/portal"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/serviceactions"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/store"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/worktools"
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

	portalService := portal.New(pool)
	if value := os.Getenv("ACCESS_PUBLIC_URL"); value != "" {
		if err := setPublicURL(&portalService.AccessURL, value); err != nil {
			return err
		}
	}
	if value := os.Getenv("CONFLUENCE_PUBLIC_URL"); value != "" {
		if err := setPublicURL(&portalService.KnowledgeURL, value); err != nil {
			return err
		}
	}
	if err := portalService.EnsureSeed(ctx); err != nil {
		return fmt.Errorf("seed portal knowledge: %w", err)
	}
	actions, err := serviceactions.New(&serviceactions.PGStore{Pool: pool}, serviceactions.Config{
		HRSecret: cfg.SessionSecret, JiraSecret: os.Getenv("JIRA_SESSION_SECRET"),
		Hiring:      serviceactions.Endpoint{URL: os.Getenv("HR_HIRING_URL"), PublicURL: os.Getenv("HR_HIRING_PUBLIC_URL")},
		Offboarding: serviceactions.Endpoint{URL: os.Getenv("HR_OFFBOARDING_URL"), PublicURL: os.Getenv("HR_OFFBOARDING_PUBLIC_URL")},
		Benefits:    serviceactions.Endpoint{URL: os.Getenv("HR_BENEFITS_URL"), PublicURL: os.Getenv("HR_BENEFITS_PUBLIC_URL")},
		Jira:        serviceactions.Endpoint{URL: os.Getenv("JIRA_API_URL"), PublicURL: os.Getenv("JIRA_PUBLIC_URL")},
	})
	if err != nil {
		return fmt.Errorf("service actions: %w", err)
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
		for _, origin := range []string{os.Getenv("HR_ABSENCES_URL"), os.Getenv("HR_TRIPS_URL")} {
			if err = ai.OriginOK(origin); err != nil {
				return err
			}
		}
		bridge.AbsencesURL = strings.TrimRight(os.Getenv("HR_ABSENCES_URL"), "/")
		bridge.TripsURL = strings.TrimRight(os.Getenv("HR_TRIPS_URL"), "/")
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
		bridge.Actions = actions
		bridge.JiraURL = strings.TrimRight(os.Getenv("JIRA_API_URL"), "/")
		if err = ai.OriginOK(bridge.JiraURL); err != nil {
			return err
		}
		bridge.PublicJiraURL = "http://localhost:5189"
		if origin := os.Getenv("JIRA_PUBLIC_URL"); origin != "" {
			if err = setPublicURL(&bridge.PublicJiraURL, origin); err != nil {
				return err
			}
			bridge.PublicJiraURL = strings.TrimRight(bridge.PublicJiraURL, "/")
		}
		bridge.Portal = portalService
		bridge.HRSecret = cfg.SessionSecret
		bridge.DemoMode = cfg.DemoMode
		chat = buddy.NewChat(bridge)
	}
	api := httpapi.NewAPI(sessions, onboarding, access, notifications, chat).WithPortal(portalService).WithServiceActions(actions)

	if cfg.DemoMode && os.Getenv("WORK_TOOLS_ENABLED") == "true" {
		setupCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		knowledgeDB, setupErr := portalService.OpenKnowledgeDatabase(setupCtx, cfg.DatabaseURL)
		if setupErr != nil {
			return fmt.Errorf("setup Confluence database: %w", setupErr)
		}
		defer knowledgeDB.Close()
		catalog, setupErr := worktools.Open(setupCtx, pool, cfg.DatabaseURL)
		cancel()
		if setupErr != nil {
			return fmt.Errorf("setup work tools: %w", setupErr)
		}
		defer catalog.Close()
		api.WithWorkTools(catalog)
		if bridge != nil {
			bridge.WorkTools = catalog
		}
	}
	if bridge != nil {
		api.WithInternalRoutes(bridge.Register).WithTeamGuide(st).WithHRToday(bridge.TodayHR)
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
