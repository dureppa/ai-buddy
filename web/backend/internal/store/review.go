package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/dureppa/ai-buddy/web/backend/internal/buddy"
	"github.com/jackc/pgx/v5"
)

func (s *Store) StartReview(ctx context.Context, profile, evaluation, answer, version string) error {
	tag, err := s.q.Exec(ctx, `INSERT INTO task_reviews(profile_id,task_id,evaluation_id,answer,evidence_version,state) VALUES($1,'consent-news',$2,$3,$4,'evaluating') ON CONFLICT(profile_id,task_id) DO UPDATE SET evaluation_id=$2,answer=$3,evidence_version=$4,state='evaluating',assessment=NULL,reviewed_by=NULL,review_note='',updated_at=now() WHERE task_reviews.state!='completed'`, profile, evaluation, answer, version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return buddy.ErrInvalidInput
	}
	return nil
}
func (s *Store) SaveAssessment(ctx context.Context, profile, evaluation string, result json.RawMessage, ready bool) error {
	state := "needs_revision"
	if ready {
		state = "awaiting_review"
	}
	tag, err := s.q.Exec(ctx, `UPDATE task_reviews SET assessment=$3,state=$4,updated_at=now() WHERE profile_id=$1 AND task_id='consent-news' AND evaluation_id=$2 AND state='evaluating'`, profile, evaluation, result, state)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return buddy.ErrInvalidInput
	}
	return nil
}
func (s *Store) TaskReview(ctx context.Context, profile string) (buddy.TaskReview, error) {
	var review buddy.TaskReview
	err := s.q.QueryRow(ctx, `SELECT profile_id,task_id,evaluation_id::text,answer,evidence_version,state,assessment,reviewed_by,review_note FROM task_reviews WHERE profile_id=$1 AND task_id='consent-news'`, profile).Scan(&review.ProfileID, &review.TaskID, &review.EvaluationID, &review.Answer, &review.EvidenceVersion, &review.State, &review.Assessment, &review.ReviewedBy, &review.ReviewNote)
	if errors.Is(err, pgx.ErrNoRows) {
		return review, buddy.ErrNotFound
	}
	return review, err
}
func (s *Store) DecideReview(ctx context.Context, profile, evaluation, reviewer, note, version string, approve bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var state, currentVersion, currentID string
	err = tx.QueryRow(ctx, `SELECT state,evidence_version,evaluation_id::text FROM task_reviews WHERE profile_id=$1 AND task_id='consent-news' FOR UPDATE`, profile).Scan(&state, &currentVersion, &currentID)
	if err != nil {
		return buddy.ErrNotFound
	}
	if currentID != evaluation || state != "awaiting_review" || (approve && currentVersion != version) {
		return buddy.ErrInvalidInput
	}
	state = "needs_revision"
	if approve {
		state = "completed"
		if _, err = tx.Exec(ctx, `INSERT INTO onboarding_progress(profile_id,task_id) VALUES($1,'consent-news') ON CONFLICT DO NOTHING`, profile); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE task_reviews SET state=$2,reviewed_by=$3,review_note=$4,updated_at=now() WHERE profile_id=$1 AND task_id='consent-news'`, profile, state, reviewer, note); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
