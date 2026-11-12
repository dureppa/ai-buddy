-- Запускается суперпользователем через scripts/db-setup.sh.

SELECT format('CREATE ROLE %I LOGIN', :'pguser')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'pguser')\gexec

SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'pguser', :'pgpass')\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'pgdatabase', :'pguser')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'pgdatabase')\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'testdatabase', :'pguser')
WHERE :'testdatabase' <> ''
  AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'testdatabase')\gexec