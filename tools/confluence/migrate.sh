#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 -v password="$CONFLUENCE_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE buddy_confluence LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='buddy_confluence') \gexec
SELECT format('ALTER ROLE buddy_confluence PASSWORD %L', :'password') \gexec
SELECT 'CREATE DATABASE buddy_tool_confluence'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='buddy_tool_confluence') \gexec
REVOKE CONNECT ON DATABASE buddy_tool_confluence FROM PUBLIC;
GRANT CONNECT ON DATABASE buddy_tool_confluence TO buddy_confluence;
\connect buddy_tool_confluence
CREATE TABLE IF NOT EXISTS confluence_pages (
  id text PRIMARY KEY, product_id text, parent_id text, kind text NOT NULL,
  title text NOT NULL, body text NOT NULL, version integer NOT NULL,
  updated_at timestamptz NOT NULL
);
GRANT SELECT ON confluence_pages TO buddy_confluence;
SQL

# Keep newer pages already present in the dedicated database when upgrading.
if [ "$(psql -Atc "SELECT to_regclass('public.confluence_pages') IS NOT NULL")" = t ]; then
  psql -v ON_ERROR_STOP=1 -c "COPY (SELECT id,product_id,parent_id,kind,title,body,version,updated_at FROM confluence_pages) TO STDOUT" > /tmp/legacy-pages.tsv
fi
if [ -f /tmp/legacy-pages.tsv ]; then
  psql -d buddy_tool_confluence -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE legacy_pages (LIKE confluence_pages);
\copy legacy_pages FROM '/tmp/legacy-pages.tsv'
INSERT INTO confluence_pages SELECT * FROM legacy_pages
ON CONFLICT (id) DO UPDATE SET
  product_id=excluded.product_id, parent_id=excluded.parent_id, kind=excluded.kind,
  title=excluded.title, body=excluded.body, version=excluded.version, updated_at=excluded.updated_at
WHERE confluence_pages.version < excluded.version;
COMMIT;
SQL
fi

psql -d buddy_tool_confluence -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE seed (raw jsonb);
\copy seed FROM PROGRAM 'tr "\n" " " < /data/confluence-pages.json' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02')
INSERT INTO confluence_pages (id, product_id, parent_id, kind, title, body, version, updated_at)
SELECT p.id, p.product_id, p.parent_id, p.kind, p.title, p.body, 1, now()
FROM seed, jsonb_to_recordset(raw) AS p(id text, product_id text, parent_id text, kind text, title text, body text)
ON CONFLICT (id) DO NOTHING;
COMMIT;
SQL
