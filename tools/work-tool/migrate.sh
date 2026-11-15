#!/bin/sh
set -eu

for fixture in /data/*/demo.json; do
  service=$(basename "$(dirname "$fixture")")
  case "$service" in
    ''|*[!a-z-]*) exit 1 ;;
  esac
  suffix=$(printf '%s' "$service" | tr '-' '_')
  key=$(printf '%s' "$suffix" | tr 'a-z' 'A-Z')
  database="buddy_tool_$suffix"
  password=$(printenv "TOOL_${key}_DB_PASSWORD")
  psql -v ON_ERROR_STOP=1 -v database="$database" -v password="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', :'database')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'database') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'database', :'password') \gexec
SELECT format('CREATE DATABASE %I', :'database')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname=:'database') \gexec
REVOKE CONNECT ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO :"database";
SQL
  tr '\n' ' ' < "$fixture" > /tmp/tool-seed.json
  psql -d "$database" -v ON_ERROR_STOP=1 -v role="$database" <<'SQL'
BEGIN;
CREATE TABLE IF NOT EXISTS records (
  team text NOT NULL, id text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(team,id)
);
GRANT SELECT ON records TO :"role";
CREATE TEMP TABLE seed (raw jsonb);
\copy seed FROM '/tmp/tool-seed.json' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02')
INSERT INTO records (team,id,payload)
SELECT record->>'team', record->>'id', record
FROM seed, jsonb_array_elements(raw->'records') AS record
ON CONFLICT (team,id) DO NOTHING;
COMMIT;
SQL
done
