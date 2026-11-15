ALTER TABLE profiles ADD COLUMN job_role text CHECK(job_role IN ('analyst','backend','tester','designer','staff'));
ALTER TABLE profiles ADD COLUMN can_review_access boolean NOT NULL DEFAULT false;
UPDATE profiles SET job_role=CASE id WHEN 'olga' THEN 'analyst' WHEN 'sasha' THEN 'backend' WHEN 'timur' THEN 'tester' WHEN 'maria' THEN 'designer' END WHERE id IN ('olga','sasha','timur','maria');
INSERT INTO profiles(id,display_name,role,team_id,internship_started_on,job_role,can_review_access) VALUES
 ('manager','Алексей Морозов','Руководитель','delivery','2026-01-01','staff',true),
 ('mentor','Анна Ким','Наставник','delivery','2026-01-01','staff',false),
 ('travel-manager','Екатерина Павлова','Руководитель','travel','2026-01-01','staff',true),
 ('travel-mentor','Илья Воронцов','Наставник','travel','2026-01-01','staff',false),
 ('autoteca-manager','Роман Громов','Руководитель','autoteca','2026-01-01','staff',true),
 ('autoteca-mentor','Нина Белова','Наставник','autoteca','2026-01-01','staff',false),
 ('help-manager','Михаил Орлов','Руководитель','help','2026-01-01','staff',true),
 ('help-mentor','Дарья Волкова','Наставник','help','2026-01-01','staff',false)
ON CONFLICT(id) DO UPDATE SET job_role=excluded.job_role, can_review_access=excluded.can_review_access;
CREATE TABLE portal_resources (
 product_id text NOT NULL REFERENCES teams(id), template_id text NOT NULL,
 resource_key text NOT NULL, fields jsonb NOT NULL DEFAULT '{}',
 PRIMARY KEY(product_id,template_id,resource_key)
);
CREATE TABLE portal_access_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 profile_id text NOT NULL REFERENCES profiles(id), product_id text NOT NULL REFERENCES teams(id),
 template_id text NOT NULL, resource_key text NOT NULL, permission text NOT NULL CHECK(permission IN ('read','write','admin')),
 scope_key text NOT NULL, input jsonb NOT NULL, operation_key text NOT NULL,
 status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','cancelled')),
 origin text NOT NULL CHECK(origin IN ('portal','agent')),
 created_at timestamptz NOT NULL DEFAULT now(), decision_by text REFERENCES profiles(id),
 decision_note text NOT NULL DEFAULT '', decided_at timestamptz,
 UNIQUE(profile_id,operation_key),
 FOREIGN KEY(product_id,template_id,resource_key) REFERENCES portal_resources(product_id,template_id,resource_key)
);
CREATE UNIQUE INDEX portal_active_access ON portal_access_requests(profile_id,template_id,resource_key,permission,scope_key) WHERE status IN ('submitted','approved');
CREATE INDEX portal_requests_product ON portal_access_requests(product_id,created_at DESC);
CREATE TABLE confluence_pages (
 id text PRIMARY KEY, product_id text REFERENCES teams(id), parent_id text REFERENCES confluence_pages(id),
 kind text NOT NULL CHECK(kind IN ('product','team','role','guide')),
 title text NOT NULL, body text NOT NULL, version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX confluence_pages_product ON confluence_pages(product_id);
