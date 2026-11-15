package shared

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var demoProducts = map[string]string{
	"olga": "delivery", "sasha": "travel", "timur": "autoteca", "maria": "help",
	"mentor": "delivery", "manager": "delivery",
	"travel-mentor": "travel", "travel-manager": "travel",
	"autoteca-mentor": "autoteca", "autoteca-manager": "autoteca",
	"help-mentor": "help", "help-manager": "help",
}

type Sessions struct {
	Secret           []byte
	DelegationSecret []byte
	Audience         string
	Demo             bool
}

func (s Sessions) Login(w http.ResponseWriter, r *http.Request) {
	if !s.Demo {
		http.NotFound(w, r)
		return
	}
	var input struct {
		Profile string `json:"profile_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if json.NewDecoder(r.Body).Decode(&input) != nil || demoProducts[input.Profile] == "" {
		Error(w, 400, "invalid_input")
		return
	}
	claims := jwt.RegisteredClaims{
		Subject: input.Profile, Audience: jwt.ClaimStrings{s.Audience},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.Secret)
	if err != nil {
		Error(w, 503, "unavailable")
		return
	}
	Write(w, 200, map[string]string{"access_token": token, "profile_id": input.Profile})
}

func (s Sessions) Product(r *http.Request) string {
	subject, _ := s.Subject(r)
	return demoProducts[subject]
}

func (s Sessions) Subject(r *http.Request) (string, bool) {
	value, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return "", false
	}
	for index, secret := range [][]byte{s.Secret, s.DelegationSecret} {
		if len(secret) == 0 {
			continue
		}
		claims := &jwt.RegisteredClaims{}
		token, err := jwt.ParseWithClaims(value, claims, func(*jwt.Token) (any, error) {
			return secret, nil
		}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired(), jwt.WithAudience(s.Audience))
		if err == nil && token.Valid {
			if demoProducts[claims.Subject] != "" {
				return claims.Subject, index == 1
			}
		}
	}
	return "", false
}

func Write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func Error(w http.ResponseWriter, status int, code string) {
	Write(w, status, map[string]string{"code": code})
}
