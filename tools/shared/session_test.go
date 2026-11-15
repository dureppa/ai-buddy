package shared

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDemoSession(t *testing.T) {
	s := Sessions{Secret: []byte("test secret"), Audience: "confluence", Demo: true}
	response := httptest.NewRecorder()
	s.Login(response, httptest.NewRequest("POST", "/", strings.NewReader(`{"profile_id":"olga"}`)))
	if response.Code != 200 {
		t.Fatalf("login status %d", response.Code)
	}
	var payload map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "/", nil)
	request.Header.Set("Authorization", "Bearer "+payload["access_token"])
	if got := s.Product(request); got != "delivery" {
		t.Fatalf("product: %q", got)
	}
	s.Audience = "grafana"
	if got := s.Product(request); got != "" {
		t.Fatalf("token accepted for another service: %q", got)
	}
	s.Demo = false
	response = httptest.NewRecorder()
	s.Login(response, httptest.NewRequest("POST", "/", strings.NewReader(`{"profile_id":"olga"}`)))
	if response.Code != 404 {
		t.Fatalf("disabled login status %d", response.Code)
	}
}
