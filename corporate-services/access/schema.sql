BEGIN;
CREATE TABLE IF NOT EXISTS teams (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY, display_name text NOT NULL, team_id text NOT NULL REFERENCES teams(id),
  job_role text NOT NULL
);
INSERT INTO teams VALUES
 ('delivery','Путь заказа'), ('travel','Бронирование жилья'),
 ('autoteca','Качество отчётов'), ('help','Участие в проектах')
ON CONFLICT DO NOTHING;
INSERT INTO profiles VALUES
 ('olga','Ольга Соколова','delivery','analyst'),
 ('sasha','Александр Ким','travel','backend'),
 ('timur','Тимур Алиев','autoteca','tester'),
 ('maria','Мария Лебедева','help','designer'),
 ('manager','Алексей Морозов','delivery','staff'),
 ('mentor','Анна Ким','delivery','staff'),
 ('travel-manager','Екатерина Павлова','travel','staff'),
 ('travel-mentor','Илья Воронцов','travel','staff'),
 ('autoteca-manager','Роман Громов','autoteca','staff'),
 ('autoteca-mentor','Нина Белова','autoteca','staff'),
 ('help-manager','Михаил Орлов','help','staff'),
 ('help-mentor','Дарья Волкова','help','staff')
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS portal_resources (
 product_id text NOT NULL REFERENCES teams(id), template_id text NOT NULL,
 resource_key text NOT NULL, fields jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(product_id,template_id,resource_key)
);
CREATE TABLE IF NOT EXISTS portal_access_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 profile_id text NOT NULL REFERENCES profiles(id), product_id text NOT NULL REFERENCES teams(id),
 template_id text NOT NULL, resource_key text NOT NULL,
 permission text NOT NULL CHECK(permission IN ('read','write','admin')),
 scope_key text NOT NULL, input jsonb NOT NULL, operation_key text NOT NULL,
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','cancelled')),
 origin text NOT NULL CHECK(origin IN ('portal','agent')),
 created_at timestamptz NOT NULL DEFAULT now(), decision_by text REFERENCES profiles(id),
 decision_note text NOT NULL DEFAULT '', decided_at timestamptz,
 UNIQUE(profile_id,operation_key),
 FOREIGN KEY(product_id,template_id,resource_key) REFERENCES portal_resources(product_id,template_id,resource_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_active_access ON portal_access_requests(profile_id,template_id,resource_key,permission,scope_key) WHERE status IN ('submitted','approved');
CREATE INDEX IF NOT EXISTS portal_requests_product ON portal_access_requests(product_id,created_at DESC);
CREATE TABLE IF NOT EXISTS access_migrations (name text PRIMARY KEY);
GRANT SELECT ON teams, profiles TO buddy_access;
GRANT SELECT, INSERT ON portal_resources TO buddy_access;
GRANT SELECT, INSERT, UPDATE ON portal_access_requests TO buddy_access;
GRANT USAGE ON SEQUENCE portal_access_requests_number_seq TO buddy_access;
COMMIT;
