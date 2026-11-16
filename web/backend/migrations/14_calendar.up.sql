CREATE TABLE calendar_state (
    profile_id text PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    imported boolean NOT NULL DEFAULT false
);
CREATE TABLE calendar_events (
    profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    id text NOT NULL,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    kind text NOT NULL CHECK (kind IN ('Встреча','Созвон','Напоминание')),
    starts_at timestamptz NOT NULL,
    description text NOT NULL DEFAULT '',
    origin text NOT NULL DEFAULT 'user' CHECK (origin IN ('seed','user')),
    deleted boolean NOT NULL DEFAULT false,
    PRIMARY KEY(profile_id,id)
);
CREATE INDEX calendar_events_time ON calendar_events(profile_id,starts_at) WHERE NOT deleted;
ALTER TABLE service_action_drafts DROP CONSTRAINT service_action_drafts_service_check;
ALTER TABLE service_action_drafts ADD CONSTRAINT service_action_drafts_service_check
    CHECK (service IN ('hiring','offboarding','benefits','jira','access','calendar'));
