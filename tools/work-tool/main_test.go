package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/dureppa/ai-buddy/tools/shared"
	"github.com/dureppa/ai-buddy/tools/shared/servicetest"
)

func TestToolRoutesAcrossAllFixtures(t *testing.T) {
	fixtures, err := filepath.Glob("../*/demo.json")
	if err != nil || len(fixtures) != 13 {
		t.Fatalf("expected 13 tool configurations, got %d (%v)", len(fixtures), err)
	}
	profiles := map[string]string{"delivery": "olga", "travel": "sasha", "autoteca": "timur", "help": "maria"}
	for _, path := range fixtures {
		name := filepath.Base(filepath.Dir(path))
		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var fixture page
			if err := json.Unmarshal(raw, &fixture); err != nil || fixture.Name == "" || len(fixture.Records) == 0 {
				t.Fatalf("invalid fixture: %v", err)
			}
			db := servicetest.Postgres(t, "CREATE TABLE records(team text, id text, payload jsonb, PRIMARY KEY(team,id))")
			teams := map[string]bool{}
			for _, item := range fixture.Records {
				if profiles[item.Team] == "" {
					t.Fatalf("record %s has unknown team %q", item.ID, item.Team)
				}
				teams[item.Team] = true
				if _, err := db.Exec(context.Background(), "INSERT INTO records VALUES ($1,$2,$3)", item.Team, item.ID, item); err != nil {
					t.Fatal(err)
				}
			}
			api := "/api/v1/work-tools/" + name
			handler := routes(db, name, fixture, shared.Sessions{Secret: []byte("test-secret"), Audience: name, Demo: true})
			servicetest.Check(t, handler, httptest.NewRequest("GET", api, nil), http.StatusUnauthorized, "unauthenticated")
			for team, profile := range profiles {
				token := servicetest.Login(t, handler, api+"/demo/sessions", profile)
				request := servicetest.Authorized("GET", api, token, "")
				if !teams[team] {
					servicetest.Check(t, handler, request, http.StatusNotFound, "not_found")
					continue
				}
				recorder := httptest.NewRecorder()
				handler.ServeHTTP(recorder, request)
				var result page
				if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || recorder.Code != 200 || len(result.Records) == 0 {
					t.Fatalf("profile %s: %d %s", profile, recorder.Code, recorder.Body.String())
				}
				for _, item := range result.Records {
					if item.Team != team {
						t.Fatalf("profile %s received record %s from %s", profile, item.ID, item.Team)
					}
				}
			}
		})
	}
}
