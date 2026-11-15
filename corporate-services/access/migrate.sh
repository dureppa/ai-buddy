#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 -v password="$ACCESS_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE buddy_access LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='buddy_access') \gexec
SELECT format('ALTER ROLE buddy_access PASSWORD %L', :'password') \gexec
SELECT 'CREATE DATABASE buddy_access'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='buddy_access') \gexec
REVOKE CONNECT ON DATABASE buddy_access FROM PUBLIC;
GRANT CONNECT ON DATABASE buddy_access TO buddy_access;
SQL

psql -d buddy_access -v ON_ERROR_STOP=1 -f /data/schema.sql
ready=$(psql -Atc "SELECT to_regclass('public.portal_access_requests') IS NOT NULL")
done=$(psql -d buddy_access -Atc "SELECT EXISTS(SELECT 1 FROM access_migrations WHERE name='legacy-import')")
if [ "$ready" != t ] || [ "$done" = t ]; then
  exit 0
fi

psql -v ON_ERROR_STOP=1 <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\copy (SELECT id,name FROM teams) TO '/tmp/access-teams.tsv'
\copy (SELECT id,display_name,team_id,COALESCE(job_role,'staff') FROM profiles) TO '/tmp/access-profiles.tsv'
\copy portal_resources TO '/tmp/access-resources.tsv'
\copy portal_access_requests TO '/tmp/access-requests.tsv'
COMMIT;
SQL

psql -d buddy_access -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE legacy_teams (LIKE teams);
CREATE TEMP TABLE legacy_profiles (LIKE profiles);
CREATE TEMP TABLE legacy_resources (LIKE portal_resources);
CREATE TEMP TABLE legacy_requests (LIKE portal_access_requests);
\copy legacy_teams FROM '/tmp/access-teams.tsv'
\copy legacy_profiles FROM '/tmp/access-profiles.tsv'
\copy legacy_resources FROM '/tmp/access-resources.tsv'
\copy legacy_requests FROM '/tmp/access-requests.tsv'
INSERT INTO teams SELECT * FROM legacy_teams ON CONFLICT(id) DO UPDATE SET name=excluded.name;
INSERT INTO profiles SELECT * FROM legacy_profiles ON CONFLICT(id) DO UPDATE
  SET display_name=excluded.display_name,team_id=excluded.team_id,job_role=excluded.job_role;
INSERT INTO portal_resources SELECT * FROM legacy_resources ON CONFLICT DO NOTHING;
UPDATE portal_access_requests r
SET status=x.status, decision_by=x.decision_by, decision_note=x.decision_note, decided_at=x.decided_at
FROM legacy_requests x WHERE r.id=x.id;
INSERT INTO portal_access_requests OVERRIDING SYSTEM VALUE SELECT * FROM legacy_requests ON CONFLICT(id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('portal_access_requests','number'),
  COALESCE(MAX(number), 1), MAX(number) IS NOT NULL) FROM portal_access_requests;
INSERT INTO access_migrations VALUES ('legacy-import');
COMMIT;
SQL
