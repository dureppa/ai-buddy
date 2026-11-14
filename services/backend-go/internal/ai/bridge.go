// Package ai connects Go business data to Flask and the Python MCP adapter.
package ai

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
	"github.com/golang-jwt/jwt/v5"
)

type Repository interface {
	StartReview(context.Context, string, string, string, string) error
	SaveAssessment(context.Context, string, string, json.RawMessage, bool) error
	TaskReview(context.Context, string) (buddy.TaskReview, error)
	DecideReview(context.Context, string, string, string, string, string, bool) error
	ChatTurn(context.Context, string, buddy.ChatMessage, func(string, []buddy.HistoryMessage) (buddy.ChatReply, error)) (buddy.ChatReply, error)
	Conversation(context.Context, string, string) ([]buddy.HistoryMessage, error)
	ProfileByID(context.Context, string) (buddy.Profile, error)
	ReadAI(context.Context, string, string, map[string]any) (map[string]any, error)
}
type Claims struct {
	RequestID      string `json:"request_id"`
	ConversationID string `json:"conversation_id"`
	jwt.RegisteredClaims
}
type Bridge struct {
	DemoMode                                                 bool
	Store                                                    Repository
	URL, ServiceToken, AdapterToken, Secret, HRURL, HRSecret string
	Client                                                   *http.Client
}

func New(st Repository, endpoint, service, adapter, secret, hr string) (*Bridge, error) {
	for _, raw := range []string{endpoint, hr} {
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "agent" || u.Hostname() == "hr-consents"))) {
			return nil, fmt.Errorf("invalid AI/HR origin")
		}
	}
	if endpoint == "" || len(service) < 16 || len(adapter) < 16 || len(secret) < 32 || service == adapter || secret == service || secret == adapter {
		return nil, fmt.Errorf("separate AI secrets required")
	}
	return &Bridge{Store: st, URL: strings.TrimRight(endpoint, "/"), ServiceToken: service, AdapterToken: adapter, Secret: secret, HRURL: strings.TrimRight(hr, "/"), Client: &http.Client{Timeout: 26 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func uuid() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func (b *Bridge) token(subject, request, conversation, audience string) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{request, conversation, jwt.RegisteredClaims{Subject: subject, Audience: jwt.ClaimStrings{audience}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(time.Minute))}}).SignedString([]byte(b.Secret))
}
func (b *Bridge) claims(raw, audience string) (*Claims, error) {
	c := &Claims{}
	t, err := jwt.ParseWithClaims(raw, c, func(*jwt.Token) (any, error) { return []byte(b.Secret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithAudience(audience), jwt.WithExpirationRequired())
	if err != nil || !t.Valid || c.Subject == "" || c.RequestID == "" || c.ConversationID == "" {
		return nil, buddy.ErrUnauthenticated
	}
	return c, nil
}
func (b *Bridge) Ask(ctx context.Context, profile string, msg buddy.ChatMessage) (buddy.ChatReply, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return b.Store.ChatTurn(ctx, profile, msg, func(conversation string, history []buddy.HistoryMessage) (buddy.ChatReply, error) {
		request := uuid()
		delegation, err := b.token(profile, request, conversation, "mcp-delegation")
		if err != nil {
			return buddy.ChatReply{}, err
		}
		payload := map[string]any{"request_id": request, "conversation_id": conversation, "message": msg.Text, "history": history, "delegation_token": delegation}
		if msg.PageURL != "" {
			payload["page_context"] = map[string]string{"url": msg.PageURL}
		}
		var out struct {
			RequestID      string `json:"request_id"`
			ConversationID string `json:"conversation_id"`
			Reply          struct {
				Text       string            `json:"text"`
				References []buddy.Reference `json:"references"`
			} `json:"reply"`
		}
		if err = b.request(ctx, "POST", b.URL+"/internal/v1/turns", b.ServiceToken, payload, &out); err != nil {
			return buddy.ChatReply{}, buddy.ErrUnavailable
		}
		if out.RequestID != request || out.ConversationID != conversation || strings.TrimSpace(out.Reply.Text) == "" || len([]rune(out.Reply.Text)) > 4000 || len(out.Reply.References) > 5 {
			return buddy.ChatReply{}, buddy.ErrUnavailable
		}
		for _, ref := range out.Reply.References {
			u, e := url.Parse(ref.URL)
			if e != nil || ref.Title == "" || u.User != nil || (!(strings.HasPrefix(ref.URL, "/") && !strings.HasPrefix(ref.URL, "//")) && (u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https"))) {
				return buddy.ChatReply{}, buddy.ErrUnavailable
			}
		}
		if out.Reply.References == nil {
			out.Reply.References = []buddy.Reference{}
		}
		return buddy.ChatReply{ConversationID: conversation, Kind: "answer", Text: out.Reply.Text, References: out.Reply.References}, nil
	})
}
func (b *Bridge) request(ctx context.Context, method, endpoint, token string, payload, out any) error {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := b.Client.Do(req)
	if err != nil {
		return buddy.ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return buddy.ErrUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 65537))
	if err != nil || len(data) > 65536 {
		return buddy.ErrUnavailable
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if dec.Decode(out) != nil {
		return buddy.ErrUnavailable
	}
	if dec.Decode(new(any)) != io.EOF {
		return buddy.ErrUnavailable
	}
	return nil
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func failure(w http.ResponseWriter, status int, code string) {
	write(w, status, map[string]any{"ok": false, "error": map[string]any{"code": code, "message": "Запрос не выполнен", "retryable": status == 503}})
}
func bearer(r *http.Request) string {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}
func (b *Bridge) Register(mux *http.ServeMux) {
	b.registerReview(mux)
	mux.HandleFunc("POST /internal/v1/ai/context/resolve", b.resolve)
	for path, tool := range map[string]string{"POST /internal/v1/ai/knowledge/search": "search_knowledge", "GET /internal/v1/ai/team-context": "get_team_context", "GET /internal/v1/ai/onboarding/progress": "get_onboarding_progress", "POST /internal/v1/ai/onboarding/task-context": "get_task_context", "POST /internal/v1/ai/onboarding/task-evidence": "get_task_evidence"} {
		mux.HandleFunc(path, b.read(tool))
	}
}
func decode(w http.ResponseWriter, r *http.Request, out any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 65536)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return buddy.ErrInvalidInput
	}
	return nil
}
func (b *Bridge) resolve(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(bearer(r)), []byte(b.AdapterToken)) != 1 {
		failure(w, 401, "UNAUTHORIZED")
		return
	}
	var in struct {
		Delegation string `json:"delegation_token"`
	}
	if decode(w, r, &in) != nil {
		failure(w, 400, "INVALID_ARGUMENTS")
		return
	}
	c, err := b.claims(in.Delegation, "mcp-delegation")
	if err != nil {
		write(w, 200, map[string]bool{"active": false})
		return
	}
	if _, err = b.Store.ProfileByID(r.Context(), c.Subject); err != nil {
		write(w, 200, map[string]bool{"active": false})
		return
	}
	c.Audience = jwt.ClaimStrings{"mcp-resource"}
	resource, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(b.Secret))
	if err != nil {
		failure(w, 503, "TEMPORARILY_UNAVAILABLE")
		return
	}
	write(w, 200, map[string]any{"active": true, "subject_id": c.Subject, "request_id": c.RequestID, "conversation_id": c.ConversationID, "expires_at": c.ExpiresAt.Time.UTC().Format(time.RFC3339), "api_token": resource, "allowed_tools": []string{"search_knowledge", "get_team_context", "get_onboarding_progress", "get_task_context", "get_task_evidence"}})
}
func (b *Bridge) read(tool string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := b.claims(bearer(r), "mcp-resource")
		if err != nil {
			failure(w, 401, "CONTEXT_EXPIRED")
			return
		}
		if r.Header.Get("X-Request-ID") != c.RequestID {
			failure(w, 403, "FORBIDDEN")
			return
		}
		if _, err = b.Store.ProfileByID(r.Context(), c.Subject); err != nil {
			failure(w, 403, "FORBIDDEN")
			return
		}
		args := map[string]any{}
		if r.Method == "POST" && decode(w, r, &args) != nil {
			failure(w, 400, "INVALID_ARGUMENTS")
			return
		}
		var data map[string]any
		if tool == "get_task_evidence" {
			data, err = b.evidence(r.Context(), c.Subject, args)
		} else {
			data, err = b.Store.ReadAI(r.Context(), c.Subject, tool, args)
		}
		if err != nil {
			if err == buddy.ErrNotFound {
				failure(w, 404, "NOT_FOUND")
			} else if err == buddy.ErrInvalidInput {
				failure(w, 400, "INVALID_ARGUMENTS")
			} else {
				failure(w, 503, "TEMPORARILY_UNAVAILABLE")
			}
			return
		}
		write(w, 200, map[string]any{"ok": true, "data": data})
	}
}

func (b *Bridge) Conversation(ctx context.Context, profile, id string) ([]buddy.HistoryMessage, error) {
	return b.Store.Conversation(ctx, profile, id)
}
