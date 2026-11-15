CREATE TABLE service_action_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    service text NOT NULL CHECK(service IN ('hiring','offboarding','benefits','jira')),
    operation text NOT NULL,
    fingerprint text NOT NULL,
    payload jsonb NOT NULL,
    title text NOT NULL,
    fields jsonb NOT NULL,
    service_url text NOT NULL,
    state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','executing','succeeded','failed','uncertain','cancelled')),
    result text NOT NULL DEFAULT '',
    started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
    UNIQUE(profile_id,request_id,fingerprint)
);
CREATE INDEX service_action_owner_hash ON service_action_drafts(profile_id,fingerprint,created_at DESC);
