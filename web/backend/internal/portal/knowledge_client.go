package portal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/golang-jwt/jwt/v5"
)

type KnowledgeClient struct {
	origin string
	secret []byte
	http   *http.Client
}

func NewKnowledgeClient(origin, secret string) (*KnowledgeClient, error) {
	return newPortalClient(origin, secret, "CONFLUENCE")
}

func newPortalClient(origin, secret, service string) (*KnowledgeClient, error) {
	u, err := url.Parse(origin)
	if err != nil || u == nil || u.Host == "" || u.User != nil ||
		(u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" || strings.Trim(u.Path, "/") != "" {
		return nil, fmt.Errorf("invalid %s_API_URL", service)
	}
	if len(secret) < 32 {
		return nil, fmt.Errorf("%s_DELEGATION_SECRET must contain at least 32 bytes", service)
	}
	return &KnowledgeClient{origin: strings.TrimRight(origin, "/"), secret: []byte(secret), http: &http.Client{
		Timeout:       5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func (c *KnowledgeClient) Pages(ctx context.Context, subject, query string) ([]Page, error) {
	var pages []Page
	err := c.get(ctx, subject, "pages?"+url.Values{"query": {query}}.Encode(), &pages)
	return pages, err
}

func (c *KnowledgeClient) Page(ctx context.Context, subject, id string) (Page, error) {
	if id == "" || id == "." || id == ".." {
		return Page{}, buddy.ErrInvalidInput
	}
	var page Page
	err := c.get(ctx, subject, "pages/"+url.PathEscape(id), &page)
	return page, err
}

func (c *KnowledgeClient) Search(ctx context.Context, subject, query string, limit int) ([]Page, error) {
	var pages []Page
	values := url.Values{"query": {query}, "limit": {strconv.Itoa(limit)}}
	err := c.get(ctx, subject, "search?"+values.Encode(), &pages)
	if len(pages) > limit {
		return nil, buddy.ErrUnavailable
	}
	return pages, err
}

func (c *KnowledgeClient) get(ctx context.Context, subject, path string, result any) error {
	claims := jwt.RegisteredClaims{
		Subject: subject, Audience: jwt.ClaimStrings{"confluence"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(c.secret)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.origin+"/api/v1/confluence/"+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
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
	default:
		return buddy.ErrUnavailable
	}
}
