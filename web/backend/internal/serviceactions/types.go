// Package serviceactions reads corporate services and executes immutable drafts only after user confirmation.
package serviceactions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

var ErrInvalid = errors.New("invalid service action")
var ErrNotFound = errors.New("service resource not found")
var ErrForbidden = errors.New("service resource forbidden")
var ErrUnavailable = errors.New("service unavailable")
var ErrConflict = errors.New("service state changed")

type Field struct {
	Label string `json:"label"`
	Value string `json:"value"`
}
type Draft struct {
	ID          string          `json:"id"`
	Service     string          `json:"service"`
	Operation   string          `json:"operation"`
	State       string          `json:"state"`
	Title       string          `json:"title"`
	Fields      []Field         `json:"fields"`
	ExpiresAt   time.Time       `json:"expires_at"`
	ServiceURL  string          `json:"service_url"`
	Result      string          `json:"result"`
	Profile     string          `json:"-"`
	RequestID   string          `json:"-"`
	Fingerprint string          `json:"-"`
	StartedAt   *time.Time      `json:"-"`
	Payload     json.RawMessage `json:"-"`
}
type Repository interface {
	Save(context.Context, Draft) (Draft, error)
	Get(context.Context, string, string) (Draft, error)
	Claim(context.Context, string, string) (Draft, bool, error)
	Finish(context.Context, string, string, string, string) (Draft, error)
	Cancel(context.Context, string, string) (Draft, error)
}
type Endpoint struct{ URL, PublicURL string }
type Config struct {
	Hiring, Offboarding, Benefits, Jira Endpoint
	HRSecret, JiraSecret                string
}
type Service struct {
	Store  Repository
	Config Config
	Client *http.Client
}

type contextArgs struct {
	Service string  `json:"service"`
	BoardID *string `json:"board_id"`
	IssueID *string `json:"issue_id"`
}
