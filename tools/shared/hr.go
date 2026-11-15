package shared

import "net/http"

// WithDemoSession accepts the local, audience-bound token before checking
// tokens from the existing Buddy integration.
func (s Sessions) WithDemoSession(
	next func(http.ResponseWriter, *http.Request, string),
	buddy http.HandlerFunc,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.Demo {
			if subject, _ := s.Subject(r); subject != "" {
				next(w, r, subject)
				return
			}
		}
		buddy(w, r)
	}
}
