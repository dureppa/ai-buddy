CREATE TABLE role_checklist_progress (
    profile_id text PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    completed_ids text[] NOT NULL
);
