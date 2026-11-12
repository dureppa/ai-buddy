CREATE TABLE onboarding_tasks (
    id         text PRIMARY KEY,
    title      text NOT NULL,
    guidance   text NOT NULL,
    action_url text,
    sort_order integer NOT NULL UNIQUE CHECK (sort_order > 0)
);

CREATE TABLE onboarding_progress (
    profile_id   text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    task_id      text NOT NULL REFERENCES onboarding_tasks (id) ON DELETE CASCADE,
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, task_id)
);