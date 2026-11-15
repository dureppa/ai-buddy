CREATE TABLE notifications (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id   text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (length(btrim(kind)) > 0),
    title        text NOT NULL,
    body         text NOT NULL,
    action_title text NOT NULL,
    action_url   text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, kind)
);

CREATE TABLE page_guides (
    url      text PRIMARY KEY CHECK (url ~ '^https?://' AND url !~ '[?#]'),
    title    text NOT NULL,
    guidance text NOT NULL
);

CREATE TABLE knowledge_articles (
    id         text PRIMARY KEY,
    title      text NOT NULL,
    url        text NOT NULL,
    content    text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);