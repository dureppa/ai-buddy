package buddy

import "encoding/json"

type TaskReview struct {
	ProfileID       string          `json:"profile_id"`
	TaskID          string          `json:"task_id"`
	EvaluationID    string          `json:"evaluation_id"`
	Answer          string          `json:"answer"`
	EvidenceVersion string          `json:"evidence_version"`
	State           string          `json:"state"`
	Assessment      json.RawMessage `json:"assessment"`
	ReviewedBy      *string         `json:"reviewed_by"`
	ReviewNote      string          `json:"review_note"`
}
