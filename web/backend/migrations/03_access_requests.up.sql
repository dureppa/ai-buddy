-- Заявки на доступ: черновики, сохранённые заявки и имитация корпоративного сервиса.

CREATE SEQUENCE access_request_number_seq AS bigint START WITH 1;

CREATE FUNCTION next_access_request_number() RETURNS text
LANGUAGE plpgsql VOLATILE AS
$$
BEGIN
    RETURN 'Д-' || lpad(nextval('access_request_number_seq')::text, 3, '0');
END;
$$;

CREATE TABLE access_request_drafts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    service_id text NOT NULL REFERENCES services (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
    CHECK (expires_at > created_at),
    UNIQUE (id, profile_id, service_id)
);

CREATE INDEX access_request_drafts_profile_idx ON access_request_drafts (profile_id);
CREATE INDEX access_request_drafts_expires_idx ON access_request_drafts (expires_at);

CREATE TABLE access_requests (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id   uuid NOT NULL UNIQUE,
    profile_id text NOT NULL,
    service_id text NOT NULL,
    number     text NOT NULL UNIQUE DEFAULT next_access_request_number(),
    status     text NOT NULL DEFAULT 'submitted' CHECK (status = 'submitted'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (draft_id, profile_id, service_id)
        REFERENCES access_request_drafts (id, profile_id, service_id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services (id)
);

CREATE INDEX access_requests_profile_created_idx ON access_requests (profile_id, created_at DESC);

CREATE TABLE mock_service_operations (
    operation_key text PRIMARY KEY,
    service_id    text NOT NULL REFERENCES services (id),
    profile_id    text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mock_service_operations IS
    'Имитация корпоративного сервиса. Ключ операции = id черновика. '
    'Успех фиксируется строкой; повтор с тем же ключом не выполняет операцию заново. '
    'Сбой не фиксируется, поэтому повтор возможен.';