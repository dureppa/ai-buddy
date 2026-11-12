package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/dureppa/ai-buddy/services/backend-go/internal/buddy"
)

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, err error) {
	status, code, message := mapError(err)
	if status == http.StatusInternalServerError {
		slog.Error("внутренняя ошибка", "error", err)
	}
	writeJSON(w, status, errorBody{Code: code, Message: message})
}

func mapError(err error) (int, string, string) {
	switch {
	case errors.Is(err, buddy.ErrInvalidInput):
		return http.StatusBadRequest, "invalid_input", buddy.ErrInvalidInput.Error()
	case errors.Is(err, buddy.ErrUnauthenticated):
		return http.StatusUnauthorized, "unauthenticated", buddy.ErrUnauthenticated.Error()
	case errors.Is(err, buddy.ErrForbidden):
		return http.StatusForbidden, "forbidden", buddy.ErrForbidden.Error()
	case errors.Is(err, buddy.ErrNotFound):
		return http.StatusNotFound, "not_found", buddy.ErrNotFound.Error()
	case errors.Is(err, buddy.ErrExpiredDraft):
		return http.StatusConflict, "expired_draft", buddy.ErrExpiredDraft.Error()
	case errors.Is(err, buddy.ErrUnavailable):
		return http.StatusServiceUnavailable, "unavailable", buddy.ErrUnavailable.Error()
	default:
		return http.StatusInternalServerError, "internal", "внутренняя ошибка сервера"
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return buddy.ErrInvalidInput
	}
	return nil
}
