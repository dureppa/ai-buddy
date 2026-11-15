#!/bin/sh
set -eu

if [ "$(psql -Atc "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname='buddy_access')")" != t ]; then
  exit 0
fi

if [ "$(psql -d buddy_access -Atc "SELECT to_regclass('public.access_migrations') IS NOT NULL")" != t ]; then
  exit 0
fi
if [ "$(psql -d buddy_access -Atc "SELECT EXISTS (SELECT 1 FROM access_migrations WHERE name='legacy-import')")" != t ]; then
  exit 0
fi

psql -d buddy_access -v ON_ERROR_STOP=1 <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\copy portal_resources TO '/tmp/access-rollback-resources.tsv'
\copy portal_access_requests TO '/tmp/access-rollback-requests.tsv'
COMMIT;
SQL

psql -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE restored_resources (LIKE portal_resources);
CREATE TEMP TABLE restored_requests (LIKE portal_access_requests);
\copy restored_resources FROM '/tmp/access-rollback-resources.tsv'
\copy restored_requests FROM '/tmp/access-rollback-requests.tsv'
INSERT INTO portal_resources SELECT * FROM restored_resources ON CONFLICT DO NOTHING;
UPDATE portal_access_requests r
SET status=x.status, decision_by=x.decision_by, decision_note=x.decision_note, decided_at=x.decided_at
FROM restored_requests x WHERE r.id=x.id;
INSERT INTO portal_access_requests OVERRIDING SYSTEM VALUE SELECT * FROM restored_requests
ON CONFLICT(id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('portal_access_requests','number'),
  COALESCE(MAX(number), 1), MAX(number) IS NOT NULL) FROM portal_access_requests;
COMMIT;
SQL
psql -d buddy_access -v ON_ERROR_STOP=1 -c "DELETE FROM access_migrations WHERE name='legacy-import'"
