CREATE TABLE role_checklist_extras (
    id text PRIMARY KEY DEFAULT ('extra-' || gen_random_uuid()::text),
    profile_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    stage text NOT NULL CHECK (stage IN ('week-1','week-2','month-1','month-2','month-3','after-3')),
    title text NOT NULL,
    summary text NOT NULL,
    done boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX role_checklist_extras_profile ON role_checklist_extras (profile_id, created_at DESC);
