package serviceactions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testID = "11111111-1111-4111-8111-111111111111"
const issueID = "22222222-2222-4222-8222-222222222222"
const hrKey = "synthetic-hr-secret-1234567890"
const jiraKey = "synthetic-jira-secret-1234567890"

type memoryStore struct {
	mu     sync.Mutex
	drafts map[string]Draft
}

func (m *memoryStore) Save(_ context.Context, d Draft) (Draft, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, old := range m.drafts {
		if old.Profile == d.Profile && old.Fingerprint == d.Fingerprint && (old.State == "prepared" || old.State == "executing" || old.State == "uncertain" || old.State == "succeeded") {
			return old, nil
		}
	}
	d.ID = testID
	d.State = "prepared"
	d.ExpiresAt = time.Now().Add(10 * time.Minute)
	m.drafts[d.ID] = d
	return d, nil
}
func (m *memoryStore) Get(_ context.Context, p, id string) (Draft, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.get(p, id)
}
func (m *memoryStore) get(p, id string) (Draft, error) {
	d, ok := m.drafts[id]
	if !ok || d.Profile != p {
		return Draft{}, ErrNotFound
	}
	return d, nil
}
func (m *memoryStore) Claim(_ context.Context, p, id string) (Draft, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, err := m.get(p, id)
	if err != nil {
		return d, false, err
	}
	if d.State != "prepared" || !d.ExpiresAt.After(time.Now()) {
		return d, false, nil
	}
	now := time.Now()
	d.State = "executing"
	d.StartedAt = &now
	m.drafts[id] = d
	return d, true, nil
}
func (m *memoryStore) Finish(_ context.Context, p, id, state, result string) (Draft, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, err := m.get(p, id)
	if err != nil {
		return d, err
	}
	d.State = state
	d.Result = result
	m.drafts[id] = d
	return d, nil
}
func (m *memoryStore) Cancel(_ context.Context, p, id string) (Draft, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, err := m.get(p, id)
	if err != nil {
		return d, err
	}
	if d.State == "prepared" {
		d.State = "cancelled"
		m.drafts[id] = d
	}
	return d, nil
}
func decodeMap(t *testing.T, raw string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatal(err)
	}
	return m
}
func fixtureIssue() map[string]any {
	return map[string]any{"id": issueID, "board_id": "delivery", "space_id": "delivery", "key": "DEL-1", "title": "Исходная задача", "description": strings.Repeat("Полное описание ", 200), "status": "todo", "priority": "medium", "assignee_id": "olga", "reporter_id": "olga", "due_date": "2026-12-01", "version": float64(3)}
}
func fixtureRead(path string) any {
	switch path {
	case "/api/v1/me/referral-summary":
		return map[string]any{"referral_slots": 3, "referral_left": 3, "vacancies": []any{map[string]any{"id": "backend", "title": "Go-разработчик", "description": "Команда доставки"}}, "referrals": []any{}}
	case "/api/v1/me/offboarding":
		return map[string]any{"exit_notice_days": 14, "earliest_exit": "2026-11-29", "steps": []any{map[string]any{"id": "handover", "title": "Передать дела", "description": "Согласовать с лидом"}}, "checklist": []any{"handover"}, "draft": nil}
	case "/api/v1/me/benefit-summary":
		return map[string]any{"benefit_budget": 10000, "benefit_left": 10000, "options": []any{map[string]any{"id": "sport", "title": "Спорт", "description": "Компенсация занятий", "amount": 5000, "available": true}}, "requests": []any{}}
	case "/api/v1/spaces":
		return []any{map[string]any{"id": "delivery", "name": "Доставка", "description": "Описание"}}
	case "/api/v1/spaces/delivery/boards":
		return []any{map[string]any{"id": "delivery", "name": "Доставка", "space_id": "delivery", "key": "DEL"}}
	case "/api/v1/boards/delivery":
		return map[string]any{"id": "delivery", "name": "Доставка", "space_id": "delivery", "key": "DEL", "members": []any{map[string]any{"id": "olga", "name": "Ольга"}}, "issues": []any{fixtureIssue()}}
	case "/api/v1/me/issues":
		return []any{fixtureIssue()}
	case "/api/v1/issues/" + issueID:
		return fixtureIssue()
	}
	return nil
}

type fixture struct {
	s            *Service
	store        *memoryStore
	writes       atomic.Int32
	mu           sync.Mutex
	body         map[string]any
	path, method string
	status       int
	invalid      bool
	readOverride func(string) any
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{store: &memoryStore{drafts: map[string]Draft{}}, status: 201}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := &jwt.RegisteredClaims{}
		token, err := jwt.ParseWithClaims(raw, claims, func(tok *jwt.Token) (any, error) {
			if claims.Issuer == "jira" {
				return []byte(jiraKey), nil
			}
			return []byte(hrKey), nil
		}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
		if err != nil || !token.Valid || claims.Subject != "olga" || time.Until(claims.ExpiresAt.Time) > 31*time.Second {
			t.Errorf("invalid downstream identity: %v", err)
			w.WriteHeader(403)
			return
		}
		if strings.Contains(r.URL.Path, "/boards") || strings.Contains(r.URL.Path, "/spaces") || strings.Contains(r.URL.Path, "/issues") {
			if claims.Issuer != "jira" || len(claims.Audience) != 1 || claims.Audience[0] != "jira" {
				t.Error("Jira audience missing")
			}
		}
		if r.Method == "GET" {
			value := fixtureRead(r.URL.Path)
			if f.readOverride != nil {
				if custom := f.readOverride(r.URL.Path); custom != nil {
					value = custom
				}
			}
			if value == nil {
				w.WriteHeader(404)
				return
			}
			_ = json.NewEncoder(w).Encode(value)
			return
		}
		f.writes.Add(1)
		f.mu.Lock()
		f.path = r.URL.Path
		f.method = r.Method
		_ = json.NewDecoder(r.Body).Decode(&f.body)
		f.mu.Unlock()
		w.WriteHeader(f.status)
		if f.invalid {
			_, _ = w.Write([]byte(`{"lost":true}`))
			return
		}
		result := map[string]any{"id": issueID}
		if strings.Contains(r.URL.Path, "/checklist/") {
			result = map[string]any{"step": "handover", "checked": true}
		}
		if strings.HasSuffix(r.URL.Path, "/draft") {
			result = map[string]any{"date": "2026-12-10"}
		}
		_ = json.NewEncoder(w).Encode(result)
	}))
	t.Cleanup(server.Close)
	endpoint := Endpoint{URL: server.URL, PublicURL: "https://corporate.example/"}
	var err error
	f.s, err = New(f.store, Config{Hiring: endpoint, Offboarding: endpoint, Benefits: endpoint, Jira: endpoint, HRSecret: hrKey, JiraSecret: jiraKey})
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func prepared(t *testing.T, f *fixture, action string) Draft {
	t.Helper()
	out, err := f.s.Prepare(context.Background(), "olga", issueID, map[string]any{"action": decodeMap(t, action)})
	if err != nil {
		t.Fatal(err)
	}
	if f.writes.Load() != 0 {
		t.Fatal("prepare wrote downstream")
	}
	d := out["draft"].(Draft)
	refs := out["references"].([]any)
	if refs[0].(map[string]any)["url"] != "/actions/"+d.ID {
		t.Fatal("confirmation link missing")
	}
	return d
}
func TestContexts(t *testing.T) {
	for _, service := range []string{"hiring", "offboarding", "benefits", "jira"} {
		t.Run(service, func(t *testing.T) {
			f := newFixture(t)
			out, err := f.s.Context(context.Background(), "olga", map[string]any{"service": service})
			if err != nil || out["service"] != service {
				t.Fatalf("%v %v", out, err)
			}
			if service == "jira" {
				issue := out["issues"].([]any)[0].(map[string]any)
				if issue["description_truncated"] != true {
					t.Fatal("missing truncation flag")
				}
				for _, args := range []map[string]any{{"service": "jira", "board_id": "delivery"}, {"service": "jira", "issue_id": issueID}} {
					if _, err = f.s.Context(context.Background(), "olga", args); err != nil {
						t.Fatal(err)
					}
				}
			}
		})
	}
}
func TestSixConfirmedActions(t *testing.T) {
	cases := []struct{ action, path, method string }{
		{`{"operation":"refer_candidate","vacancy":"backend","name":"Иван Тест","email":"ivan@example.com"}`, "/api/v1/me/referrals", "POST"},
		{`{"operation":"set_exit_step","step":"handover","checked":true}`, "/api/v1/me/offboarding/checklist/handover", "PUT"},
		{`{"operation":"save_exit_draft","date":"2026-12-10"}`, "/api/v1/me/offboarding/draft", "POST"},
		{`{"operation":"request_benefit","benefit":"sport"}`, "/api/v1/me/benefit-requests", "POST"},
		{`{"operation":"create_jira_issue","board_id":"delivery","title":"Новая задача"}`, "/api/v1/boards/delivery/issues", "POST"},
		{`{"operation":"update_jira_issue","issue_id":"` + issueID + `","version":3,"changes":{"status":"done","assignee_id":null}}`, "/api/v1/issues/" + issueID, "PUT"},
	}
	for _, c := range cases {
		t.Run(c.path+c.method, func(t *testing.T) {
			f := newFixture(t)
			d := prepared(t, f, c.action)
			same, err := f.s.Prepare(context.Background(), "olga", testID, map[string]any{"action": decodeMap(t, c.action)})
			if err != nil || same["draft"].(Draft).ID != d.ID {
				t.Fatal("draft not reused", err)
			}
			result, err := f.s.Confirm(context.Background(), "olga", d.ID)
			if err != nil || result.State != "succeeded" {
				t.Fatalf("%+v %v", result, err)
			}
			if f.writes.Load() != 1 || f.path != c.path || f.method != c.method {
				t.Fatalf("wrong write: %d %s %s", f.writes.Load(), f.method, f.path)
			}
			if d.Operation == "update_jira_issue" {
				if f.body["description"] != fixtureIssue()["description"] || f.body["title"] != "Исходная задача" || f.body["assignee_id"] != nil || f.body["status"] != "done" {
					t.Fatal("patch lost unchanged fields", f.body)
				}
			}
			if d.Operation == "request_benefit" {
				if len(f.body) != 1 || f.body["benefit"] != "sport" {
					t.Fatal("private snapshot leaked", f.body)
				}
			}
			if _, err = f.s.Confirm(context.Background(), "olga", d.ID); err != nil || f.writes.Load() != 1 {
				t.Fatal("confirmation replayed")
			}
		})
	}
}
func TestNoReplayAndOwner(t *testing.T) {
	for _, state := range []string{"cancelled", "expired", "uncertain", "failed", "executing"} {
		t.Run(state, func(t *testing.T) {
			f := newFixture(t)
			d := prepared(t, f, `{"operation":"request_benefit","benefit":"sport"}`)
			if _, err := f.s.Get(context.Background(), "sasha", d.ID); !errors.Is(err, ErrNotFound) {
				t.Fatal(err)
			}
			if _, err := f.s.Confirm(context.Background(), "sasha", d.ID); !errors.Is(err, ErrNotFound) {
				t.Fatal(err)
			}
			if _, err := f.s.Cancel(context.Background(), "sasha", d.ID); !errors.Is(err, ErrNotFound) {
				t.Fatal(err)
			}
			if state == "cancelled" {
				_, _ = f.s.Cancel(context.Background(), "olga", d.ID)
			} else {
				f.store.mu.Lock()
				saved := f.store.drafts[d.ID]
				if state == "expired" {
					saved.ExpiresAt = time.Now().Add(-time.Minute)
				} else {
					saved.State = state
				}
				if state == "executing" {
					old := time.Now().Add(-time.Minute)
					saved.StartedAt = &old
				}
				f.store.drafts[d.ID] = saved
				f.store.mu.Unlock()
			}
			out, err := f.s.Confirm(context.Background(), "olga", d.ID)
			if err != nil || f.writes.Load() != 0 || out.State == "prepared" {
				t.Fatalf("%+v %v", out, err)
			}
		})
	}
}
func TestConcurrentConfirmation(t *testing.T) {
	f := newFixture(t)
	d := prepared(t, f, `{"operation":"request_benefit","benefit":"sport"}`)
	var group sync.WaitGroup
	for range 12 {
		group.Go(func() {
			if _, err := f.s.Confirm(context.Background(), "olga", d.ID); err != nil {
				t.Error(err)
			}
		})
	}
	group.Wait()
	if f.writes.Load() != 1 {
		t.Fatal("duplicate writes", f.writes.Load())
	}
}
func TestUnknownOutcomeAndRejection(t *testing.T) {
	for _, c := range []struct {
		status  int
		invalid bool
		state   string
	}{{503, false, "uncertain"}, {201, true, "uncertain"}, {409, false, "failed"}, {403, false, "failed"}, {400, false, "failed"}} {
		t.Run(fmt.Sprint(c), func(t *testing.T) {
			f := newFixture(t)
			f.status = c.status
			f.invalid = c.invalid
			d := prepared(t, f, `{"operation":"request_benefit","benefit":"sport"}`)
			out, err := f.s.Confirm(context.Background(), "olga", d.ID)
			if err != nil || out.State != c.state {
				t.Fatalf("%+v %v", out, err)
			}
			_, _ = f.s.Confirm(context.Background(), "olga", d.ID)
			if f.writes.Load() != 1 {
				t.Fatal("replayed failed write")
			}
		})
	}
}
func TestRevalidation(t *testing.T) {
	for _, kind := range []string{"version", "price", "budget", "eligibility"} {
		t.Run(kind, func(t *testing.T) {
			f := newFixture(t)
			action := `{"operation":"request_benefit","benefit":"sport"}`
			if kind == "version" {
				action = `{"operation":"update_jira_issue","issue_id":"` + issueID + `","version":3,"changes":{"status":"done"}}`
			}
			d := prepared(t, f, action)
			f.readOverride = func(path string) any {
				if kind == "version" && strings.Contains(path, "/issues/") {
					issue := fixtureIssue()
					issue["version"] = float64(4)
					return issue
				}
				if kind != "version" && strings.HasSuffix(path, "benefit-summary") {
					v := fixtureRead(path).(map[string]any)
					if kind == "budget" {
						v["benefit_left"] = 0
					} else {
						option := v["options"].([]any)[0].(map[string]any)
						if kind == "price" {
							option["amount"] = 6000
						} else {
							option["available"] = false
						}
					}
					return v
				}
				return nil
			}
			if _, err := f.s.Confirm(context.Background(), "olga", d.ID); err == nil || f.writes.Load() != 0 {
				t.Fatal("changed action was executed", err)
			}
		})
	}
}
func TestInvalidInputs(t *testing.T) {
	f := newFixture(t)
	for _, raw := range []string{
		`{"operation":"refer_candidate","vacancy":"backend","name":"a","email":"x"}`,
		`{"operation":"refer_candidate","vacancy":"backend","name":"Test","email":"Name <a@example.com>"}`,
		`{"operation":"request_benefit","benefit":"sport","profile_id":"sasha"}`,
		`{"operation":"request_benefit","benefit":"../sport"}`, `{"operation":"execute"}`,
		`{"operation":"set_exit_step","step":"handover","checked":"true"}`,
		`{"operation":"save_exit_draft","date":"2026-02-30"}`,
		`{"operation":"create_jira_issue","board_id":"delivery","title":"Task","status":"approved"}`,
		`{"operation":"create_jira_issue","board_id":"delivery","title":"Task","assignee_id":"sasha"}`,
		`{"operation":"update_jira_issue","issue_id":"` + issueID + `","version":3,"changes":{}}`,
		`{"operation":"update_jira_issue","issue_id":"` + issueID + `","version":3,"changes":{"title":null}}`,
		`{"operation":"update_jira_issue","issue_id":"` + issueID + `","version":3,"changes":{"description":"x","url":"https://evil.example"}}`,
	} {
		if _, err := f.s.Prepare(context.Background(), "olga", issueID, map[string]any{"action": decodeMap(t, raw)}); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	for _, args := range []map[string]any{{"service": "unknown"}, {"service": "hiring", "board_id": "delivery"}, {"service": "jira", "board_id": "../delivery"}, {"service": "jira", "issue_id": "x"}, {"service": "jira", "issue_id": issueID, "board_id": "delivery"}, {"service": "jira", "profile_id": "sasha"}} {
		if _, err := f.s.Context(context.Background(), "olga", args); err == nil {
			t.Fatal("accepted invalid context", args)
		}
	}
	if f.writes.Load() != 0 {
		t.Fatal("invalid action executed")
	}
}
func TestPublicConfirmation(t *testing.T) {
	f := newFixture(t)
	d := prepared(t, f, `{"operation":"request_benefit","benefit":"sport"}`)
	mux := http.NewServeMux()
	f.s.Register(mux, func(r *http.Request) (string, error) {
		p := r.Header.Get("X-Test-User")
		if p == "" {
			return "", ErrForbidden
		}
		return p, nil
	})
	for _, c := range []struct {
		method, path, user, body string
		status                   int
	}{{"GET", "", "", "", 401}, {"GET", "", "sasha", "", 404}, {"POST", "/confirm", "olga", `{}`, 400}, {"POST", "/confirm", "olga", `{"confirm":false}`, 400}, {"POST", "/cancel", "olga", `{"confirm":true}`, 400}, {"POST", "/confirm", "olga", `{"confirm":true,"profile":"sasha"}`, 400}, {"POST", "/confirm", "olga", `{"confirm":true}{}`, 400}, {"GET", "", "olga", "", 200}, {"POST", "/confirm", "olga", `{"confirm":true}`, 200}, {"POST", "/confirm", "olga", `{"confirm":true}`, 200}, {"POST", "/cancel", "olga", `{"confirm":false}`, 200}} {
		r := httptest.NewRequest(c.method, "/api/v1/service-actions/"+d.ID+c.path, strings.NewReader(c.body))
		r.Header.Set("X-Test-User", c.user)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != c.status {
			t.Fatalf("%+v: %d %s", c, w.Code, w.Body)
		}
	}
	if f.writes.Load() != 1 {
		t.Fatal("public replayed", f.writes.Load())
	}
}
func TestTransportBoundaries(t *testing.T) {
	for _, mode := range []string{"redirect", "oversize", "invalid-json", "wrong-type", "forbidden", "not-found", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			called := atomic.Int32{}
			other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called.Add(1) }))
			defer other.Close()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch mode {
				case "redirect":
					http.Redirect(w, r, other.URL, 307)
				case "oversize":
					_, _ = w.Write([]byte(strings.Repeat(" ", 131073)))
				case "invalid-json":
					_, _ = w.Write([]byte("{"))
				case "wrong-type":
					w.Header().Set("Content-Type", "text/html")
					_, _ = w.Write([]byte("{}"))
				case "forbidden":
					w.WriteHeader(403)
				case "not-found":
					w.WriteHeader(404)
				case "timeout":
					time.Sleep(30 * time.Millisecond)
					_, _ = w.Write([]byte("{}"))
				}
			}))
			defer server.Close()
			s, err := New(&memoryStore{}, Config{HRSecret: hrKey, Hiring: Endpoint{URL: server.URL, PublicURL: server.URL}})
			if err != nil {
				t.Fatal(err)
			}
			s.Client.Timeout = 5 * time.Millisecond
			if _, err = s.Context(context.Background(), "olga", map[string]any{"service": "hiring"}); err == nil || called.Load() != 0 {
				t.Fatal("unsafe response accepted", err)
			}
		})
	}
}
func TestConfiguration(t *testing.T) {
	for _, raw := range []string{"file:///tmp/x", "http://evil.example", "https://u:p@example.com", "https://example.com/path", "https://example.com?token=x"} {
		if _, err := New(nil, Config{HRSecret: hrKey, Hiring: Endpoint{URL: raw, PublicURL: "https://example.com"}}); err == nil {
			t.Fatal("accepted origin", raw)
		}
	}
	for _, cfg := range []Config{{HRSecret: "short"}, {HRSecret: hrKey, Jira: Endpoint{URL: "http://jira:8189", PublicURL: "https://example.com"}}, {HRSecret: hrKey, Hiring: Endpoint{URL: "http://hr-hiring:8183"}}, {HRSecret: hrKey, Hiring: Endpoint{PublicURL: "javascript:alert(1)"}}} {
		if _, err := New(nil, cfg); err == nil {
			t.Fatal("accepted config")
		}
	}
	s, err := New(nil, Config{HRSecret: hrKey})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Context(context.Background(), "olga", map[string]any{"service": "hiring"}); !errors.Is(err, ErrUnavailable) {
		t.Fatal("missing service fallback", err)
	}
}
