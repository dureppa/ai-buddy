CREATE TABLE teams (
    id           text PRIMARY KEY,
    name         text NOT NULL,
    product      text NOT NULL,
    lead_name    text NOT NULL,
    lead_contact text NOT NULL
);

CREATE TABLE profiles (
    id                    text PRIMARY KEY,
    display_name          text NOT NULL,
    role                  text NOT NULL,
    team_id               text NOT NULL REFERENCES teams (id),
    mentor_name           text,
    mentor_contact        text,
    internship_started_on date NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    name    text NOT NULL,
    role    text NOT NULL,
    contact text,
    UNIQUE (team_id, name)
);

CREATE TABLE services (
    id          text PRIMARY KEY,
    name        text NOT NULL UNIQUE,
    description text NOT NULL DEFAULT ''
);

CREATE TABLE service_request_permissions (
    profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    service_id text NOT NULL REFERENCES services (id) ON DELETE CASCADE,
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, service_id)
);

CREATE TABLE sessions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
    profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    CHECK (expires_at > created_at)
);

CREATE INDEX sessions_profile_idx ON sessions (profile_id);

COMMENT ON COLUMN sessions.token_hash IS
    'SHA-256 (hex) от bearer-токена. Сырой токен возвращается только при создании сессии.';