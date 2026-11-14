package portal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

func marshalArguments(args map[string]any) ([]byte, error) { return json.Marshal(args) }
func strictInput(raw []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	if dec.Decode(new(any)) != io.EOF {
		return buddy.ErrInvalidInput
	}
	return nil
}
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func respondError(w http.ResponseWriter, err error) {
	status, code := 503, "unavailable"
	switch {
	case errors.Is(err, buddy.ErrInvalidInput):
		status, code = 400, "invalid_input"
	case errors.Is(err, buddy.ErrUnauthenticated):
		status, code = 401, "unauthenticated"
	case errors.Is(err, buddy.ErrForbidden):
		status, code = 403, "forbidden"
	case errors.Is(err, buddy.ErrNotFound):
		status, code = 404, "not_found"
	case errors.Is(err, ErrConflict):
		status, code = 409, "conflict"
	}
	respond(w, status, map[string]string{"code": code})
}
func requestBody(w http.ResponseWriter, r *http.Request, out any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return buddy.ErrInvalidInput
	}
	if strictInput(raw, out) != nil {
		return buddy.ErrInvalidInput
	}
	return nil
}
func (s *Service) Register(mux *http.ServeMux, authenticate func(*http.Request) (string, error)) {
	wrap := func(fn func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			subject, err := authenticate(r)
			if err != nil {
				respondError(w, err)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			fn(w, r.WithContext(ctx), subject)
		}
	}
	mux.HandleFunc("GET /api/v1/portal-access/catalog", wrap(func(w http.ResponseWriter, r *http.Request, subject string) {
		data, err := s.GetCatalog(r.Context(), subject)
		if err != nil {
			respondError(w, err)
			return
		}
		respond(w, 200, data)
	}))
	mux.HandleFunc("GET /api/v1/portal-access/requests", wrap(func(w http.ResponseWriter, r *http.Request, subject string) {
		data, err := s.List(r.Context(), subject)
		if err != nil {
			respondError(w, err)
			return
		}
		respond(w, 200, data)
	}))
	mux.HandleFunc("POST /api/v1/portal-access/requests", wrap(func(w http.ResponseWriter, r *http.Request, subject string) {
		var in Input
		if err := requestBody(w, r, &in); err != nil {
			respondError(w, err)
			return
		}
		data, err := s.Submit(r.Context(), subject, in, r.Header.Get("Idempotency-Key"), "portal")
		if err != nil {
			respondError(w, err)
			return
		}
		respond(w, 200, data)
	}))
	mux.HandleFunc("POST /api/v1/portal-access/requests/{id}/decision", wrap(func(w http.ResponseWriter, r *http.Request, subject string) {
		var in struct {
			Action string `json:"action"`
			Note   string `json:"note"`
		}
		if err := requestBody(w, r, &in); err != nil {
			respondError(w, err)
			return
		}
		data, err := s.Decide(r.Context(), subject, r.PathValue("id"), in.Action, in.Note)
		if err != nil {
			respondError(w, err)
			return
		}
		respond(w, 200, data)
	}))
	mux.HandleFunc("GET /api/v1/confluence/pages", wrap(func(w http.ResponseWriter, r *http.Request, subject string) {
		data, err := s.Pages(r.Context(), subject, r.URL.Query().Get("query"))
		if err != nil {
			respondError(w, err)
			return
		}
		respond(w, 200, data)
	}))
	mux.HandleFunc("GET /api/v1/confluence/pages/{id}", wrap(func(w http.ResponseWriter, r *http.Request, subject string) {
		data, err := s.Page(r.Context(), subject, r.PathValue("id"))
		if err != nil {
			respondError(w, err)
			return
		}
		respond(w, 200, data)
	}))
}
