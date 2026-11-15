#!/bin/sh
set -eu

test -r /seeds/demo.sql

# A single psql session holds the advisory lock across the migration transactions.
{
  printf '%s\n' 'SELECT pg_advisory_lock(28147021);'
  printf '%s\n' 'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY);'
  for path in /migrations/*.up.sql; do
    version=$(basename "$path")
    printf "SELECT NOT EXISTS (SELECT FROM schema_migrations WHERE name = '%s') AS apply \\gset\n" "$version"
    printf '%s\n' '\if :apply' 'BEGIN;'
    printf '\\i %s\n' "$path"
    printf "INSERT INTO schema_migrations (name) VALUES ('%s');\n" "$version"
    printf '%s\n' 'COMMIT;' '\endif'
  done
  printf '%s\n' "SELECT NOT EXISTS (SELECT FROM schema_migrations WHERE name = 'demo.sql') AS apply \gset" '\if :apply' 'BEGIN;'
  # The repository seed manages its own transaction when run directly.
  sed '/^BEGIN;$/d; /^COMMIT;$/d' /seeds/demo.sql
  printf '\n%s\n' "INSERT INTO schema_migrations (name) VALUES ('demo.sql');" 'COMMIT;' '\endif'
} | psql -X -v ON_ERROR_STOP=1
