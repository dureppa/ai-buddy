package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
	"github.com/stretchr/testify/require"
)

type fakeRepo struct {
	Repository
	saved   buddy.ChatReply
	history []buddy.HistoryMessage
	review  buddy.TaskReview
	ready   bool
	version string
}

func (f *fakeRepo) ProfileByID(_ context.Context, id string) (buddy.Profile, error) {
	if id == "ghost" {
		return buddy.Profile{}, buddy.ErrNotFound
	}
	return buddy.Profile{ID: id}, nil
}
func (f *fakeRepo) ChatTurn(_ context.Context, profile string, msg buddy.ChatMessage, generate func(string, []buddy.HistoryMessage) (buddy.ChatReply, error)) (buddy.ChatReply, error) {
	r, e := generate("22222222-2222-4222-8222-222222222222", f.history)
	f.saved = r
	return r, e
}
func (f *fakeRepo) ReadAI(_ context.Context, _ string, tool string, args map[string]any) (map[string]any, error) {
	if tool == "get_task_context" && args["task_id"] != "consent-news" {
		return nil, buddy.ErrNotFound
	}
	return map[string]any{"references": []any{}}, nil
}
func (f *fakeRepo) Conversation(_ context.Context, profile, id string) ([]buddy.HistoryMessage, error) {
	return f.history, nil
}
func (f *fakeRepo) StartReview(_ context.Context, profile, evaluation, answer, version string) error {
	f.review = buddy.TaskReview{ProfileID: profile, TaskID: "consent-news", EvaluationID: evaluation, Answer: answer, State: "evaluating"}
	return nil
}
func (f *fakeRepo) SaveAssessment(_ context.Context, profile, evaluation string, result json.RawMessage, ready bool) error {
	f.ready = ready
	f.review.Assessment = result
	if ready {
		f.review.State = "awaiting_review"
	} else {
		f.review.State = "needs_revision"
	}
	return nil
}
func (f *fakeRepo) TaskReview(context.Context, string) (buddy.TaskReview, error) {
	return f.review, nil
}
func (f *fakeRepo) DecideReview(_ context.Context, profile, evaluation, reviewer, note, version string, approve bool) error {
	if evaluation != f.review.EvaluationID {
		return buddy.ErrInvalidInput
	}
	f.review.State = "needs_revision"
	if approve {
		f.review.State = "completed"
	}
	return nil
}
func newBridge(t *testing.T, endpoint string) (*Bridge, *fakeRepo) {
	t.Helper()
	f := &fakeRepo{}
	b, e := New(f, endpoint, "service-token-long", "adapter-token-long", strings.Repeat("d", 32), "")
	require.NoError(t, e)
	return b, f
}
func call(h http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	r.Header.Set("X-Request-ID", "11111111-1111-4111-8111-111111111111")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestChatBridgeAndTransport(t *testing.T) {
	for _, scenario := range []string{"ok", "error", "mismatch", "invalid-ref", "too-large", "redirect"} {
		t.Run(scenario, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, "Bearer service-token-long", r.Header.Get("Authorization"))
				var in map[string]any
				require.NoError(t, json.NewDecoder(r.Body).Decode(&in))
				if scenario == "error" {
					w.WriteHeader(503)
					return
				}
				if scenario == "redirect" {
					w.Header().Set("Location", "https://example.com")
					w.WriteHeader(302)
					return
				}
				if scenario == "too-large" {
					_, _ = w.Write([]byte(strings.Repeat("x", 65537)))
					return
				}
				if scenario == "mismatch" {
					in["request_id"] = "wrong"
				}
				refs := []buddy.Reference{}
				if scenario == "invalid-ref" {
					refs = append(refs, buddy.Reference{Title: "bad", URL: "javascript:alert(1)"})
				}
				write(w, 200, map[string]any{"request_id": in["request_id"], "conversation_id": in["conversation_id"], "reply": map[string]any{"text": "Ответ", "references": refs}})
			}))
			defer server.Close()
			b, f := newBridge(t, server.URL)
			f.history = []buddy.HistoryMessage{{Role: "user", Content: "Ранее"}}
			reply, err := b.Ask(context.Background(), "olga", buddy.ChatMessage{Text: "Привет", PageURL: "https://example.com/"})
			if scenario == "ok" {
				require.NoError(t, err)
				require.Equal(t, "Ответ", reply.Text)
				history, e := b.Conversation(context.Background(), "olga", reply.ConversationID)
				require.NoError(t, e)
				require.Len(t, history, 1)
			} else {
				require.ErrorIs(t, err, buddy.ErrUnavailable)
			}
		})
	}
}
func TestDelegationIsolationAndReadRoutes(t *testing.T) {
	b, _ := newBridge(t, "http://127.0.0.1:8001")
	b.PublicConsentURL = "http://demo.example:5185/"
	mux := http.NewServeMux()
	b.Register(mux)
	request, conversation := "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
	delegation, err := b.token("olga", request, conversation, "mcp-delegation")
	require.NoError(t, err)
	require.Equal(t, 401, call(mux, "POST", "/internal/v1/ai/context/resolve", "wrong", `{}`).Code)
	resolved := call(mux, "POST", "/internal/v1/ai/context/resolve", b.AdapterToken, `{"delegation_token":"`+delegation+`"}`)
	require.Equal(t, 200, resolved.Code)
	var data map[string]any
	require.NoError(t, json.Unmarshal(resolved.Body.Bytes(), &data))
	require.Equal(t, true, data["active"])
	resource := data["api_token"].(string)
	require.NotEqual(t, delegation, resource)
	for _, entry := range []struct{ method, path, body string }{{"GET", "/internal/v1/ai/team-context", ""}, {"GET", "/internal/v1/ai/onboarding/progress", ""}, {"POST", "/internal/v1/ai/knowledge/search", `{"query":"test","limit":3}`}, {"POST", "/internal/v1/ai/onboarding/task-context", `{"task_id":"consent-news"}`}} {
		require.Equal(t, 200, call(mux, entry.method, entry.path, resource, entry.body).Code)
	}
	require.Contains(t, call(mux, "POST", "/internal/v1/ai/onboarding/task-context", resource, `{"task_id":"consent-news"}`).Body.String(), b.PublicConsentURL)
	require.Equal(t, 401, call(mux, "GET", "/internal/v1/ai/team-context", delegation, "").Code)
	wrong, _ := b.token("olga", "other", conversation, "mcp-resource")
	require.Equal(t, 403, call(mux, "GET", "/internal/v1/ai/team-context", wrong, "").Code)
	ghost, _ := b.token("ghost", request, conversation, "mcp-delegation")
	require.Contains(t, call(mux, "POST", "/internal/v1/ai/context/resolve", b.AdapterToken, `{"delegation_token":"`+ghost+`"}`).Body.String(), `"active":false`)
	require.Equal(t, 400, call(mux, "POST", "/internal/v1/ai/context/resolve", b.AdapterToken, `{"extra":1}`).Code)
}
func TestConfiguration(t *testing.T) {
	_, dockerErr := New(nil, "http://agent:8001", "service-token-long", "adapter-token-long", strings.Repeat("x", 32), "http://hr-consents:8185")
	require.NoError(t, dockerErr)
	for _, url := range []string{"http://evil.example", "https://user@host", "https://host/path", "https://host?x=1"} {
		_, err := New(nil, url, "service-token-long", "adapter-token-long", strings.Repeat("x", 32), "")
		require.Error(t, err)
	}
	_, err := New(nil, "https://api.example", "same-token-long-123", "same-token-long-123", strings.Repeat("x", 32), "")
	require.Error(t, err)
	b, _ := newBridge(t, "http://127.0.0.1")
	b.Client.Timeout = time.Millisecond
}

func TestAssessmentAndStaffReview(t *testing.T) {
	hr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		write(w, 200, []map[string]any{{"purpose": "news", "title": "Новости", "description": "Учебные", "granted": true, "updated_at": "2026-11-14T12:00:00Z"}})
	}))
	defer hr.Close()
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&in))
		hash := sha256.Sum256([]byte(in["answer"].(string)))
		result := map[string]any{"manual_review_required": true, "answer_sha256": hex.EncodeToString(hash[:]), "recommendation": "ready_for_mentor_review", "criteria": []map[string]any{{"criterion_id": "voluntary", "required": true, "verdict": "pass"}, {"criterion_id": "reviewer", "required": true, "verdict": "pass"}}}
		for _, key := range []string{"evaluation_id", "answer_id", "task_id", "task_version", "plan_version", "answer_version", "rubric_id", "rubric_version", "context_version"} {
			result[key] = in[key]
		}
		write(w, 200, map[string]any{"request_id": in["request_id"], "conversation_id": in["conversation_id"], "assessment": result})
	}))
	defer model.Close()
	b, f := newBridge(t, model.URL)
	b.HRURL = hr.URL
	b.HRSecret = strings.Repeat("s", 32)
	b.DemoMode = true
	review, err := b.SubmitReview(context.Background(), "olga", "Добровольное согласие можно отозвать, наставник одобряет.")
	require.NoError(t, err)
	require.True(t, f.ready)
	require.Equal(t, "awaiting_review", review.State)
	_, err = b.SubmitReview(context.Background(), "olga", "")
	require.ErrorIs(t, err, buddy.ErrInvalidInput)
	mux := http.NewServeMux()
	b.Register(mux)
	login := call(mux, "POST", "/api/v1/demo/staff-sessions", "", `{"staff_id":"mentor"}`)
	require.Equal(t, 201, login.Code)
	var session map[string]string
	require.NoError(t, json.Unmarshal(login.Body.Bytes(), &session))
	token := session["access_token"]
	require.Equal(t, 200, call(mux, "GET", "/api/v1/staff/reviews/olga", token, "").Code)
	require.Equal(t, 403, call(mux, "GET", "/api/v1/staff/reviews/maria", token, "").Code)
	require.Equal(t, 401, call(mux, "GET", "/api/v1/staff/reviews/olga", "invalid", "").Code)
	require.Equal(t, 400, call(mux, "POST", "/api/v1/staff/reviews/olga", token, `{}`).Code)
	require.Equal(t, 409, call(mux, "POST", "/api/v1/staff/reviews/olga", token, `{"evaluation_id":"stale","approve":true,"note":""}`).Code)
	require.Equal(t, 200, call(mux, "POST", "/api/v1/staff/reviews/olga", token, `{"evaluation_id":"`+review.EvaluationID+`","approve":true,"note":"Хорошо"}`).Code)
	b.DemoMode = false
	require.Equal(t, 403, call(mux, "POST", "/api/v1/demo/staff-sessions", "", `{"staff_id":"mentor"}`).Code)
}

func TestEvidenceRevocationBlocksReview(t *testing.T) {
	granted := false
	hr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		write(w, 200, []map[string]any{{"purpose": "news", "title": "Новости", "description": "Учебные", "granted": granted, "updated_at": "v2"}})
	}))
	defer hr.Close()
	b, f := newBridge(t, "http://127.0.0.1:18001")
	b.HRURL = hr.URL
	b.HRSecret = strings.Repeat("s", 32)
	b.DemoMode = true
	f.review = buddy.TaskReview{EvaluationID: "latest", State: "awaiting_review"}
	_, err := b.SubmitReview(context.Background(), "olga", "Ответ")
	require.ErrorIs(t, err, buddy.ErrInvalidInput)
	mux := http.NewServeMux()
	b.Register(mux)
	login := call(mux, "POST", "/api/v1/demo/staff-sessions", "", `{"staff_id":"mentor"}`)
	var session map[string]string
	require.NoError(t, json.Unmarshal(login.Body.Bytes(), &session))
	require.Equal(t, 409, call(mux, "POST", "/api/v1/staff/reviews/olga", session["access_token"], `{"evaluation_id":"latest","approve":true,"note":""}`).Code)
	require.Equal(t, "awaiting_review", f.review.State)
	require.Equal(t, 200, call(mux, "POST", "/api/v1/staff/reviews/olga", session["access_token"], `{"evaluation_id":"latest","approve":false,"note":"Повтори учебный шаг"}`).Code)
	review, err := b.Review(context.Background(), "olga")
	require.NoError(t, err)
	require.Equal(t, "needs_revision", review.State)
	resource, err := b.token("olga", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "mcp-resource")
	require.NoError(t, err)
	require.Equal(t, 200, call(mux, "POST", "/internal/v1/ai/onboarding/task-evidence", resource, `{"task_id":"consent-news"}`).Code)
	require.Equal(t, 404, call(mux, "POST", "/internal/v1/ai/onboarding/task-context", resource, `{"task_id":"ghost"}`).Code)
	require.Equal(t, 400, call(mux, "POST", "/internal/v1/ai/onboarding/task-context", resource, `bad`).Code)
	b.HRURL = ""
	require.Equal(t, 503, call(mux, "POST", "/internal/v1/ai/onboarding/task-evidence", resource, `{"task_id":"consent-news"}`).Code)
}
