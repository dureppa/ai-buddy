package serviceactions

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func New(store Repository, cfg Config) (*Service, error) {
	for _, e := range []Endpoint{cfg.Hiring, cfg.Offboarding, cfg.Benefits, cfg.Jira} {
		if e.URL != "" && (e.PublicURL == "" || !validOrigin(e.URL)) {
			return nil, ErrInvalid
		}
		if e.PublicURL != "" {
			u, err := url.Parse(e.PublicURL)
			if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") || strings.ContainsAny(e.PublicURL, "\\\r\n") {
				return nil, ErrInvalid
			}
		}
	}
	if len(cfg.HRSecret) < 16 || (cfg.Jira.URL != "" && len(cfg.JiraSecret) < 16) {
		return nil, ErrInvalid
	}
	client := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{Proxy: nil, DisableCompression: true, MaxIdleConns: 20, IdleConnTimeout: 30 * time.Second}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &Service{Store: store, Config: cfg, Client: client}, nil
}
func validOrigin(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || strings.ContainsAny(raw, "\\\r\n") {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	if u.Scheme != "http" {
		return false
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1", "hr-hiring", "hr-offboarding", "hr-benefits", "jira":
		return true
	}
	return false
}
func (s *Service) endpoint(service string) (Endpoint, error) {
	var e Endpoint
	switch service {
	case "hiring":
		e = s.Config.Hiring
	case "offboarding":
		e = s.Config.Offboarding
	case "benefits":
		e = s.Config.Benefits
	case "jira":
		e = s.Config.Jira
	default:
		return e, ErrInvalid
	}
	if e.URL == "" {
		return e, ErrUnavailable
	}
	return e, nil
}
func (s *Service) request(ctx context.Context, service, profile, method, path string, payload any) (json.RawMessage, int, error) {
	e, err := s.endpoint(service)
	if err != nil {
		return nil, 0, err
	}
	key := s.Config.HRSecret
	claims := jwt.RegisteredClaims{Subject: profile, IssuedAt: jwt.NewNumericDate(time.Now()), ExpiresAt: jwt.NewNumericDate(time.Now().Add(30 * time.Second))}
	if service == "jira" {
		key = s.Config.JiraSecret
		claims.Issuer = "jira"
		claims.Audience = jwt.ClaimStrings{"jira"}
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(key))
	if err != nil {
		return nil, 0, ErrUnavailable
	}
	var body []byte
	if payload != nil {
		body, err = json.Marshal(payload)
		if err != nil {
			return nil, 0, ErrInvalid
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(e.URL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, 0, ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Encoding", "identity")
	res, err := s.Client.Do(req)
	if err != nil {
		return nil, 0, ErrUnavailable
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 131073))
	if err != nil || len(raw) > 131072 {
		return nil, res.StatusCode, ErrUnavailable
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		switch res.StatusCode {
		case 400:
			return nil, 400, ErrInvalid
		case 403:
			return nil, 403, ErrForbidden
		case 404:
			return nil, 404, ErrNotFound
		case 409:
			return nil, 409, ErrConflict
		default:
			return nil, res.StatusCode, ErrUnavailable
		}
	}
	if strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0]) != "application/json" || !json.Valid(raw) {
		return nil, res.StatusCode, ErrUnavailable
	}
	return raw, res.StatusCode, nil
}
func (s *Service) get(ctx context.Context, service, profile, path string, out any) error {
	raw, _, err := s.request(ctx, service, profile, "GET", path, nil)
	if err != nil {
		return err
	}
	if json.Unmarshal(raw, out) != nil {
		return ErrUnavailable
	}
	return nil
}
func source(service, title, address string) map[string]any {
	hash := sha256.Sum256([]byte(address))
	return map[string]any{"id": "service:" + service + ":" + hex.EncodeToString(hash[:8]), "title": title, "url": address, "version": "live-v1", "is_demo": true}
}
func projection(value map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for _, k := range keys {
		out[k] = value[k]
	}
	return out
}
func stringValue(value map[string]any, key string) string { v, _ := value[key].(string); return v }
func array(value map[string]any, key string) ([]any, error) {
	rows, ok := value[key].([]any)
	if !ok {
		return nil, ErrUnavailable
	}
	return rows, nil
}
