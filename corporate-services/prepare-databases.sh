#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 -v database="$PGDATABASE" <<'SQL'
REVOKE CONNECT ON DATABASE :"database" FROM PUBLIC;
SQL

for service in absences trips hiring offboarding consents benefits documents events; do
  key=$(printf '%s' "$service" | tr 'a-z' 'A-Z')
  database="hr_$service"
  password=$(printenv "HR_${key}_DB_PASSWORD")
  psql -v ON_ERROR_STOP=1 -v database="$database" -v password="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE', :'database')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'database') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'database', :'password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database', :'database')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname=:'database') \gexec
REVOKE CONNECT ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO :"database";
SQL
done
