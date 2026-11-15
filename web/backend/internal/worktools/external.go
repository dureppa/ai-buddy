package worktools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/golang-jwt/jwt/v5"
)

func NewExternal(publicURL, secret string) (*Catalog, error) {
	u, err := url.Parse(publicURL)
	if err != nil || u == nil || u.Host == "" || u.User != nil ||
		(u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" || strings.Trim(u.Path, "/") != "" {
		return nil, fmt.Errorf("invalid WORK_TOOLS_PUBLIC_URL")
	}
	if len(secret) < 32 {
		return nil, fmt.Errorf("WORK_TOOL_DELEGATION_SECRET must contain at least 32 bytes")
	}
	catalog := &Catalog{
		publicURL: strings.TrimRight(publicURL, "/"),
		secret:    []byte(secret),
		external: &http.Client{
			Timeout:       2 * time.Second,
			Transport:     &http.Transport{Proxy: nil, DisableCompression: true},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
	if err := json.Unmarshal(fixtures, &catalog.services); err != nil {
		return nil, err
	}
	return catalog, nil
}

var teamProfiles = map[string]string{
	"delivery": "olga", "travel": "sasha", "autoteca": "timur", "help": "maria",
}

func (c *Catalog) readExternal(ctx context.Context, team, service string) (Page, error) {
	// Records are scoped to product. Use a demo profile of the authorized product
	// to issue the delegation after Buddy has checked its own session.
	profile := teamProfiles[team]
	if profile == "" {
		return Page{}, buddy.ErrNotFound
	}
	claims := jwt.RegisteredClaims{
		Subject: profile, Audience: jwt.ClaimStrings{service},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(c.secret)
	if err != nil {
		return Page{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://tool-"+service+":8200/api/v1/work-tools/"+service, nil)
	if err != nil {
		return Page{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := c.external.Do(req)
	if err != nil {
		return Page{}, buddy.ErrUnavailable
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusNotFound:
		return Page{}, buddy.ErrNotFound
	case http.StatusOK:
		raw, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
		if err != nil || len(raw) > 2<<20 {
			return Page{}, buddy.ErrUnavailable
		}
		var page Page
		decoder := json.NewDecoder(strings.NewReader(string(raw)))
		if decoder.Decode(&page) != nil || decoder.Decode(new(any)) != io.EOF || page.Records == nil {
			return Page{}, buddy.ErrUnavailable
		}
		for _, record := range page.Records {
			if record.Team != team || !recordID.MatchString(record.ID) || strings.TrimSpace(record.Title) == "" {
				return Page{}, buddy.ErrUnavailable
			}
		}
		meta := c.services[service]
		page.Name = meta.Name
		page.Area = meta.Area
		return page, nil
	default:
		return Page{}, buddy.ErrUnavailable
	}
}
