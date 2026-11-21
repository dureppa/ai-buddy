package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
)

// This fixture has no AI client, database connection, listener or runtime config.
// All requests exercise the real router, auth, validation and JSON response code.
type loadAssistant struct{ calls atomic.Int64 }

func (a *loadAssistant) Ask(_ context.Context, profile string, msg buddy.ChatMessage) (buddy.ChatReply, error) {
	a.calls.Add(1)
	return buddy.ChatReply{Kind: "answer", Text: profile + ":" + msg.Text, References: []buddy.Reference{}}, nil
}

func loadSize(name string, fallback, maximum int) (int, error) {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > maximum {
		return 0, fmt.Errorf("%s must be an integer in [1, %d]", name, maximum)
	}
	return value, nil
}

func TestLoadSize(t *testing.T) {
	for _, tc := range []struct {
		raw     string
		want    int
		invalid bool
	}{
		{"", 8, false}, {"1", 1, false}, {"256", 256, false},
		{"0", 0, true}, {"-1", 0, true}, {"257", 0, true}, {"bad", 0, true},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			t.Setenv("LOAD_WORKERS", tc.raw)
			got, err := loadSize("LOAD_WORKERS", 8, 256)
			if got != tc.want || (err != nil) != tc.invalid {
				t.Fatalf("loadSize(%q) = %d, %v; want %d, invalid=%v", tc.raw, got, err, tc.want, tc.invalid)
			}
		})
	}
}

func TestBackendLoad(t *testing.T) {
	requests, err := loadSize("LOAD_REQUESTS", 120, 100000)
	if err != nil {
		t.Fatal(err)
	}
	workers, err := loadSize("LOAD_WORKERS", 8, 256)
	if err != nil {
		t.Fatal(err)
	}
	api, token := onboardAPI(&fakeOnbStore{tasks: []buddy.OnboardingTask{
		{ID: "papers", Title: "Документы", Completed: true},
		{ID: "intro", Title: "Встреча с наставником", Guidance: "Назначь встречу"},
	}})
	assistant := &loadAssistant{}
	api.chat = buddy.NewChat(assistant)
	handler := api.Routes()
	cases := []struct {
		name, method, path, body, want string
		status                         int
		auth                           bool
	}{
		{"onboarding", "GET", "/api/v1/onboarding", "", `"next_task_id":"intro"`, 200, true},
		{"notifications", "GET", "/api/v1/notifications", "", `[]`, 200, true},
		{"access_requests", "GET", "/api/v1/access-requests", "", `[]`, 200, true},
		{"chat_stub", "POST", "/api/v1/chat/messages", `{"text":"load-%d"}`, `"text":"olga:load-%d"`, 200, true},
		{"invalid_chat", "POST", "/api/v1/chat/messages", `{"text":" "}`, `"code":"invalid_input"`, 400, true},
		{"unauthorized", "GET", "/api/v1/onboarding", "", `"code":"unauthenticated"`, 401, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			latencies := make([]time.Duration, requests)
			failures := make([]string, requests)
			var next atomic.Int64
			var group sync.WaitGroup
			start := make(chan struct{})
			before := assistant.calls.Load()
			for range min(workers, requests) {
				group.Go(func() {
					<-start
					for {
						index := int(next.Add(1) - 1)
						if index >= requests {
							return
						}
						body, want := tc.body, tc.want
						if tc.name == "chat_stub" {
							body, want = fmt.Sprintf(body, index), fmt.Sprintf(want, index)
						}
						req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(body))
						req.Header.Set("Content-Type", "application/json")
						if tc.auth {
							req.Header.Set("Authorization", "Bearer "+token)
						}
						rec := httptest.NewRecorder()
						began := time.Now()
						handler.ServeHTTP(rec, req)
						latencies[index] = time.Since(began)
						if rec.Code != tc.status || !json.Valid(rec.Body.Bytes()) || !strings.Contains(rec.Body.String(), want) {
							failures[index] = fmt.Sprintf("request %d: status=%d body=%s", index, rec.Code, rec.Body.String())
						}
					}
				})
			}
			began := time.Now()
			close(start)
			group.Wait()
			elapsed := time.Since(began)
			errors := 0
			for _, failure := range failures {
				if failure != "" {
					errors++
					if errors <= 3 {
						t.Error(failure)
					}
				}
			}
			wantCalls := int64(0)
			if tc.name == "chat_stub" {
				wantCalls = int64(requests)
			}
			if got := assistant.calls.Load() - before; got != wantCalls {
				t.Errorf("stub calls=%d, want %d", got, wantCalls)
			}
			slices.Sort(latencies)
			t.Logf("LOAD_RESULT scenario=%s requests=%d workers=%d errors=%d rps=%.2f p50_ms=%.3f p95_ms=%.3f p99_ms=%.3f max_ms=%.3f",
				tc.name, requests, min(workers, requests), errors, float64(requests)/elapsed.Seconds(),
				float64(latencies[(requests*50+99)/100-1])/float64(time.Millisecond),
				float64(latencies[(requests*95+99)/100-1])/float64(time.Millisecond),
				float64(latencies[(requests*99+99)/100-1])/float64(time.Millisecond),
				float64(latencies[requests-1])/float64(time.Millisecond))
		})
	}
}

// Benchmarks use the same in-process HTTP boundary; -cpu controls concurrency.
func BenchmarkBackendOnboarding(b *testing.B) {
	api, token := onboardAPI(&fakeOnbStore{tasks: []buddy.OnboardingTask{{ID: "intro", Title: "Встреча"}}})
	handler := api.Routes()
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/onboarding", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"next_task_id":"intro"`) {
				b.Errorf("unexpected onboarding response: %d %s", rec.Code, rec.Body.String())
			}
		}
	})
}
