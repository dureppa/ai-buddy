package calendar

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

func (s *Service) Register(mux *http.ServeMux, identity func(*http.Request) (string, error)) {
	handler := func(op string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			profile, err := identity(r)
			if err != nil {
				http.Error(w, "unauthenticated", 401)
				return
			}
			var out any = map[string]bool{"ok": true}
			decode := func(v any) error {
				r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
				d := json.NewDecoder(r.Body)
				d.DisallowUnknownFields()
				if d.Decode(v) != nil || d.Decode(new(any)) != io.EOF {
					return ErrInvalid
				}
				return nil
			}
			switch op {
			case "list":
				var events []Event
				var more bool
				events, more, err = s.Store.List(r.Context(), profile, time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2101, 1, 1, 0, 0, 0, 0, time.UTC), 500)
				out = map[string]any{"events": events, "has_more": more}
			case "put":
				var e Event
				if err = decode(&e); err == nil {
					if e.ID != r.PathValue("event_id") {
						err = ErrInvalid
					} else {
						out, err = s.Put(r.Context(), profile, e, false)
					}
				}
			case "delete":
				err = s.Delete(r.Context(), profile, r.PathValue("event_id"))
			case "import":
				var in struct {
					Events []Event `json:"events"`
				}
				if err = decode(&in); err == nil {
					err = s.Import(r.Context(), profile, in.Events)
				}
			}
			if err != nil {
				code := 503
				if errors.Is(err, ErrInvalid) {
					code = 400
				}
				if errors.Is(err, ErrNotFound) {
					code = 404
				}
				http.Error(w, http.StatusText(code), code)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(out)
		}
	}
	mux.HandleFunc("GET /api/v1/schedule/events", handler("list"))
	mux.HandleFunc("PUT /api/v1/schedule/events/{event_id}", handler("put"))
	mux.HandleFunc("DELETE /api/v1/schedule/events/{event_id}", handler("delete"))
	mux.HandleFunc("POST /api/v1/schedule/import", handler("import"))
}
