package store

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSaveSurveyAndHideReminder(t *testing.T) {
	pool := testPool(t)
	st := New(pool)
	ctx := context.Background()

	_, err := pool.Exec(ctx, "DELETE FROM internship_survey_responses WHERE profile_id = 'timur'")
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := pool.Exec(ctx, "DELETE FROM internship_survey_responses WHERE profile_id = 'timur'")
		require.NoError(t, err)
	})

	notifications, err := st.ListNotificationsByProfile(ctx, "timur")
	require.NoError(t, err)
	require.Len(t, notifications, 2)

	answers := map[string]string{
		"mentor": "5", "hr_bp": "na", "buddy": "4", "frequency": "2",
		"tasks": "5", "access": "3", "comment": "Всё понятно",
	}
	require.NoError(t, st.SaveSurvey(ctx, "timur", "first", answers))
	require.NoError(t, st.SaveSurvey(ctx, "timur", "first", map[string]string{"mentor": "1"}))

	var saved map[string]string
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT answers FROM internship_survey_responses WHERE profile_id = 'timur' AND stage = 'first'`).Scan(&saved))
	require.Equal(t, answers, saved)
	stages, err := st.CompletedSurveys(ctx, "timur")
	require.NoError(t, err)
	require.Equal(t, []string{"first"}, stages)
	stages, err = st.CompletedSurveys(ctx, "maria")
	require.NoError(t, err)
	require.Empty(t, stages)

	notifications, err = st.ListNotificationsByProfile(ctx, "timur")
	require.NoError(t, err)
	require.Len(t, notifications, 1)
	require.Equal(t, "first-day", notifications[0].Kind)
}
