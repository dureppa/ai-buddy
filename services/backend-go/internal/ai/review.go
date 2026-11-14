package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
	"github.com/golang-jwt/jwt/v5"
)

const question = "Как можно изменить учебное согласие на внутренние новости, можно ли его отозвать и кто одобряет завершение задания?"

var criteria = []map[string]any{
	{"id": "voluntary", "description": "Понимает добровольность согласия", "expected": "Согласие добровольное, его можно предоставить и отозвать в сервисе согласий.", "required": true},
	{"id": "reviewer", "description": "Знает роль наставника", "expected": "Агент оценивает знания, наставник одобряет завершение, бэкенд применяет переход.", "required": true},
}

func (b *Bridge) Review(ctx context.Context, profile string) (buddy.TaskReview, error) {
	return b.Store.TaskReview(ctx, profile)
}
func (b *Bridge) evidenceVersion(ctx context.Context, profile string) (string, error) {
	data, err := b.evidence(ctx, profile, map[string]any{"task_id": "consent-news"})
	if err != nil {
		return "", err
	}
	items, ok := data["items"].([]any)
	if !ok || len(items) != 1 {
		return "", buddy.ErrInvalidInput
	}
	item, ok := items[0].(map[string]any)
	if !ok || item["confirmed"] != true {
		return "", buddy.ErrInvalidInput
	}
	version, ok := item["version"].(string)
	if !ok || version == "" {
		return "", buddy.ErrInvalidInput
	}
	return version, nil
}
func (b *Bridge) SubmitReview(ctx context.Context, profile, answer string) (buddy.TaskReview, error) {
	if strings.TrimSpace(answer) == "" || len([]rune(answer)) > 4000 {
		return buddy.TaskReview{}, buddy.ErrInvalidInput
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	version, err := b.evidenceVersion(ctx, profile)
	if err != nil {
		return buddy.TaskReview{}, err
	}
	evaluation, answerID, request, conversation := uuid(), uuid(), uuid(), uuid()
	if err = b.Store.StartReview(ctx, profile, evaluation, answer, version); err != nil {
		return buddy.TaskReview{}, err
	}
	payload := map[string]any{"request_id": request, "conversation_id": conversation, "evaluation_id": evaluation, "answer_id": answerID, "task_id": "consent-news", "task_version": "1", "plan_version": "1", "answer_version": evaluation, "rubric_id": "consent-news-v1", "rubric_version": "1", "context_version": version, "question": question, "answer": answer, "context": "Учебный сервис согласий. Согласие добровольное, его можно предоставить и отозвать. Агент оценивает знания, наставник одобряет завершение, Go применяет переход.", "criteria": criteria}
	var response struct {
		RequestID      string          `json:"request_id"`
		ConversationID string          `json:"conversation_id"`
		Assessment     json.RawMessage `json:"assessment"`
	}
	modelErr := b.request(ctx, "POST", b.URL+"/internal/v1/assessments", b.ServiceToken, payload, &response)
	if modelErr != nil || response.RequestID != request || response.ConversationID != conversation {
		_ = b.Store.SaveAssessment(ctx, profile, evaluation, nil, false)
		return buddy.TaskReview{}, buddy.ErrUnavailable
	}
	var result map[string]any
	if json.Unmarshal(response.Assessment, &result) != nil {
		_ = b.Store.SaveAssessment(ctx, profile, evaluation, nil, false)
		return buddy.TaskReview{}, buddy.ErrUnavailable
	}
	hash := sha256.Sum256([]byte(answer))
	valid := result["answer_sha256"] == hex.EncodeToString(hash[:]) && result["manual_review_required"] == true
	for key, expected := range map[string]any{"evaluation_id": evaluation, "answer_id": answerID, "task_id": "consent-news", "task_version": "1", "plan_version": "1", "answer_version": evaluation, "rubric_id": "consent-news-v1", "rubric_version": "1", "context_version": version} {
		if result[key] != expected {
			valid = false
		}
	}
	if !valid {
		_ = b.Store.SaveAssessment(ctx, profile, evaluation, nil, false)
		return buddy.TaskReview{}, buddy.ErrUnavailable
	}
	ready := result["recommendation"] == "ready_for_mentor_review"
	judgments, ok := result["criteria"].([]any)
	if !ok || len(judgments) != len(criteria) {
		ready = false
	}
	seen := map[string]bool{}
	for _, raw := range judgments {
		item, ok := raw.(map[string]any)
		if !ok {
			ready = false
			continue
		}
		id, _ := item["criterion_id"].(string)
		if seen[id] || (id != "voluntary" && id != "reviewer") || item["required"] != true || item["verdict"] != "pass" {
			ready = false
		}
		seen[id] = true
	}
	currentVersion, currentErr := b.evidenceVersion(ctx, profile)
	if currentErr != nil || currentVersion != version {
		ready = false
	}
	if err = b.Store.SaveAssessment(ctx, profile, evaluation, response.Assessment, ready); err != nil {
		return buddy.TaskReview{}, err
	}
	return b.Store.TaskReview(ctx, profile)
}
func (b *Bridge) registerReview(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/demo/staff-sessions", func(w http.ResponseWriter, r *http.Request) {
		if !b.DemoMode {
			failure(w, 403, "FORBIDDEN")
			return
		}
		var in struct {
			Staff string `json:"staff_id"`
		}
		if decode(w, r, &in) != nil || (in.Staff != "mentor" && in.Staff != "lead") {
			failure(w, 400, "INVALID_ARGUMENTS")
			return
		}
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{Subject: in.Staff, Audience: jwt.ClaimStrings{"staff-review"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}).SignedString([]byte(b.Secret))
		if err != nil {
			failure(w, 503, "TEMPORARILY_UNAVAILABLE")
			return
		}
		write(w, 201, map[string]string{"access_token": token})
	})
	mux.HandleFunc("GET /api/v1/staff/reviews/{profile_id}", b.staff(false))
	mux.HandleFunc("POST /api/v1/staff/reviews/{profile_id}", b.staff(true))
}
func (b *Bridge) staff(decide bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := &jwt.RegisteredClaims{}
		token, err := jwt.ParseWithClaims(bearer(r), claims, func(*jwt.Token) (any, error) { return []byte(b.Secret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithAudience("staff-review"), jwt.WithExpirationRequired())
		if err != nil || !token.Valid {
			failure(w, 401, "UNAUTHORIZED")
			return
		}
		profile := r.PathValue("profile_id")
		if (claims.Subject != "mentor" && claims.Subject != "lead") || (profile != "olga" && profile != "sasha" && !(claims.Subject == "lead" && profile == "maria")) {
			failure(w, 403, "FORBIDDEN")
			return
		}
		if decide {
			var in struct {
				EvaluationID string `json:"evaluation_id"`
				Approve      *bool  `json:"approve"`
				Note         string `json:"note"`
			}
			if decode(w, r, &in) != nil || in.Approve == nil || len([]rune(in.Note)) > 1000 {
				failure(w, 400, "INVALID_ARGUMENTS")
				return
			}
			version := ""
			if *in.Approve {
				version, err = b.evidenceVersion(r.Context(), profile)
				if err != nil {
					failure(w, 409, "EVIDENCE_CHANGED")
					return
				}
			}
			if err = b.Store.DecideReview(r.Context(), profile, in.EvaluationID, claims.Subject, in.Note, version, *in.Approve); err != nil {
				failure(w, 409, "STALE_REVIEW")
				return
			}
		}
		review, err := b.Store.TaskReview(r.Context(), profile)
		if err != nil {
			failure(w, 404, "NOT_FOUND")
			return
		}
		write(w, 200, review)
	}
}
