CREATE TABLE task_reviews (
 profile_id text NOT NULL REFERENCES profiles(id),
 task_id text NOT NULL REFERENCES onboarding_tasks(id),
 evaluation_id uuid NOT NULL,
 answer text NOT NULL,
 evidence_version text NOT NULL,
 state text NOT NULL CHECK(state IN ('evaluating','awaiting_review','needs_revision','completed')),
 assessment jsonb,
 reviewed_by text,
 review_note text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(profile_id,task_id)
);
