CREATE TABLE conversations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_profile_idx ON conversations (profile_id);

CREATE TABLE messages (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    sender          text NOT NULL CHECK (sender IN ('user', 'buddy')),
    kind            text CHECK (kind IN ('answer', 'clarification',
                                         'access_confirmation_required', 'access_denied')),
    content         text NOT NULL CHECK (length(btrim(content)) > 0),
    refs            jsonb CHECK (refs IS NULL OR jsonb_typeof(refs) = 'array'),
    draft_id        uuid REFERENCES access_request_drafts (id) ON DELETE SET NULL,
    page_url        text CHECK (page_url IS NULL OR (page_url ~ '^https?://' AND page_url !~ '[?#]')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK ((sender = 'user' AND kind IS NULL) OR (sender = 'buddy' AND kind IS NOT NULL)),
    CHECK (draft_id IS NULL OR kind = 'access_confirmation_required'),
    CHECK (page_url IS NULL OR sender = 'user')
);

CREATE INDEX messages_conversation_idx ON messages (conversation_id, id);

COMMENT ON COLUMN messages.refs IS 'JSON-массив Reference из OpenAPI: [{title, url}].';
COMMENT ON COLUMN messages.page_url IS 'URL без query и фрагмента; санитизация на границе API, CHECK — страховка.';