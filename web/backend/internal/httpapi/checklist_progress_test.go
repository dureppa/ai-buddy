package httpapi

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/dureppa/ai-buddy/web/backend/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestTeamAndInternReadSameChecklistProgress(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	db, err := pgxpool.New(t.Context(), dsn)
	require.NoError(t, err)
	defer db.Close()
	const intern = "progress-test"
	_, err = db.Exec(t.Context(), `INSERT INTO profiles (id,display_name,role,team_id,internship_started_on,job_role)
  VALUES ($1,'Стажёр для проверки','Стажёр','delivery',CURRENT_DATE,'analyst')`, intern)
	require.NoError(t, err)
	defer db.Exec(t.Context(), "DELETE FROM profiles WHERE id=$1", intern)

	st := store.New(db)
	sessions := buddy.NewSessions(st, buddy.NewTokens(strings.Repeat("s", 32), time.Hour), true)
	api := NewAPI(sessions, buddy.NewOnboarding(st), nil, nil, nil)
	login := func(id string) string {
		token, err := sessions.CreateDemo(t.Context(), id)
		require.NoError(t, err)
		return token
	}
	manager, trainee, foreign := login("manager"), login(intern), login("travel-manager")
	const endpoint = "/api/v1/onboarding/role-checklist"
	target := "?profile_id=" + intern
	read := func(token, method, path, body string) buddy.ChecklistProgress {
		req := doRequest(api, token, method, path, body, true)
		require.Equal(t, http.StatusOK, req.Code, req.Body.String())
		var plan buddy.ChecklistProgress
		require.NoError(t, json.Unmarshal(req.Body.Bytes(), &plan))
		return plan
	}
	before := read(trainee, "GET", endpoint, "")
	require.Equal(t, before, read(manager, "GET", endpoint+target, ""))
	require.NotEqual(t, before, read(manager, "GET", endpoint+"?profile_id=olga", ""))
	for _, token := range []string{foreign, login("olga")} {
		require.Equal(t, 403, doRequest(api, token, "GET", endpoint+target, "", true).Code)
	}
	team := doRequest(api, manager, "GET", endpoint, "", true)
	require.Equal(t, 200, team.Code)
	require.Contains(t, team.Body.String(), intern)
	require.Contains(t, team.Body.String(), "olga")
	require.NotContains(t, team.Body.String(), "sasha")

	added := read(manager, "POST", endpoint+target, `{"stage":"week-1","title":"Проверить витрину","summary":"Записать наблюдения"}`)
	require.Equal(t, before.Total+1, added.Total)
	require.Len(t, added.Extras, 1)
	id := added.Extras[0].ID
	require.Equal(t, added, read(login(intern), "GET", endpoint, ""))
	require.Equal(t, 403, doRequest(api, manager, "PUT", endpoint+"/"+id+target, `{"done":true}`, true).Code)
	require.Equal(t, 403, doRequest(api, trainee, "DELETE", endpoint+"/"+id, "", true).Code)
	require.Equal(t, 403, doRequest(api, foreign, "DELETE", endpoint+"/"+id+target, "", true).Code)
	marked := read(trainee, "PUT", endpoint+"/"+id, `{"done":true}`)
	require.Contains(t, marked.Completed, id)
	require.Equal(t, marked, read(login("manager"), "GET", endpoint+target, ""))

	require.NoError(t, st.SaveSurvey(t.Context(), intern, "first", map[string]string{"mentor": "5"}))
	surveyed := read(manager, "GET", endpoint+target, "")
	require.Contains(t, surveyed.Completed, "internship-survey-first")
	require.Equal(t, surveyed, read(trainee, "GET", endpoint, ""))

	removed := read(manager, "DELETE", endpoint+"/"+id+target, "")
	require.Equal(t, before.Total, removed.Total)
	require.NotContains(t, removed.Completed, id)
	require.Equal(t, removed, read(trainee, "GET", endpoint, ""))
}
