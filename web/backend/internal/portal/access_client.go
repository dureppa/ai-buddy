package portal

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/golang-jwt/jwt/v5"
)

type AccessClient struct {
	*KnowledgeClient
}

func NewAccessClient(origin, secret string) (*AccessClient, error) {
	client, err := newPortalClient(origin, secret, "ACCESS")
	if err != nil {
		return nil, err
	}
	return &AccessClient{client}, nil
}

func (c *AccessClient) Catalog(ctx context.Context, subject string) (map[string]any, error) {
	var result map[string]any
	err := c.call(ctx, subject, http.MethodGet, "catalog", nil, "", "", &result)
	return result, err
}

func (c *AccessClient) List(ctx context.Context, subject string) ([]Request, error) {
	var result []Request
	err := c.call(ctx, subject, http.MethodGet, "requests", nil, "", "", &result)
	return result, err
}

func (c *AccessClient) Submit(ctx context.Context, subject string, input Input, key, origin string) (Request, error) {
	var result Request
	err := c.call(ctx, subject, http.MethodPost, "requests", input, key, origin, &result)
	return result, err
}

func (c *AccessClient) Decide(ctx context.Context, subject, id, action, note string) (Request, error) {
	var result Request
	err := c.call(ctx, subject, http.MethodPost, "requests/"+url.PathEscape(id)+"/decision",
		map[string]string{"action": action, "note": note}, "", "", &result)
	return result, err
}

func (c *AccessClient) call(ctx context.Context, subject, method, path string, payload any, key, origin string, result any) error {
	claims := jwt.RegisteredClaims{
		Subject: subject, Audience: jwt.ClaimStrings{"access"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(c.secret)
	if err != nil {
		return err
	}
	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.origin+"/api/v1/portal-access/"+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("X-Access-Origin", origin)
	resp, err := c.http.Do(req)
	if err != nil {
		return buddy.ErrUnavailable
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(result); err != nil {
			return buddy.ErrUnavailable
		}
		return nil
	case http.StatusBadRequest:
		return buddy.ErrInvalidInput
	case http.StatusUnauthorized:
		return buddy.ErrUnauthenticated
	case http.StatusForbidden:
		return buddy.ErrForbidden
	case http.StatusNotFound:
		return buddy.ErrNotFound
	case http.StatusConflict:
		return ErrConflict
	default:
		return buddy.ErrUnavailable
	}
}
