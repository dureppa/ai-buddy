package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/ai"
	"github.com/dureppa/ai-buddy/services/backend-go/internal/store"
)

func runTeamGuideWorker(ctx context.Context, st *store.Store, bridge *ai.Bridge) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			attempt, cancel := context.WithTimeout(ctx, 35*time.Second)
			if err := st.GenerateNextTeamGuide(attempt, bridge.GenerateTeamGuide); err != nil && ctx.Err() == nil {
				slog.Warn("team guide generation failed")
			}
			cancel()
		}
	}
}
