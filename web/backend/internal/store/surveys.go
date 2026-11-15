package store

import "context"

func (s *Store) CompletedSurveys(ctx context.Context, profileID string) ([]string, error) {
	rows, err := s.q.Query(ctx, `
		SELECT stage FROM internship_survey_responses WHERE profile_id = $1 ORDER BY submitted_at`, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stages := []string{}
	for rows.Next() {
		var stage string
		if err := rows.Scan(&stage); err != nil {
			return nil, err
		}
		stages = append(stages, stage)
	}
	return stages, rows.Err()
}

func (s *Store) SaveSurvey(ctx context.Context, profileID, stage string, answers map[string]string) error {
	_, err := s.q.Exec(ctx, `
		INSERT INTO internship_survey_responses (profile_id, stage, answers)
		VALUES ($1, $2, $3::jsonb)
		ON CONFLICT (profile_id, stage) DO NOTHING`, profileID, stage, answers)
	return err
}
