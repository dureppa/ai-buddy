#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

ENV_FILE=${ENV_FILE:-.env}
if [ ! -f "$ENV_FILE" ]; then
  echo "нет файла $ENV_FILE — скопируй .env.example" >&2
  exit 1
fi

set -a
case "$ENV_FILE" in
  */*) . "$ENV_FILE" ;;
  *)   . "./$ENV_FILE" ;;
esac
set +a

: "${PGUSER:?PGUSER не задан в .env}"
: "${PGPASSWORD:?PGPASSWORD не задан в .env}"
: "${PGDATABASE:?PGDATABASE не задан в .env}"

PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5432}
PGSSLMODE=${PGSSLMODE:-disable}
TEST_PGDATABASE=${TEST_PGDATABASE:-}
export PGHOST PGPORT PGSSLMODE

echo "==> роль и базы"
sudo -u postgres psql -q -d postgres -v ON_ERROR_STOP=1 \
  -v pguser="$PGUSER" \
  -v pgpass="$PGPASSWORD" \
  -v pgdatabase="$PGDATABASE" \
  -v testdatabase="$TEST_PGDATABASE" \
  -f migrations/00_bootstrap.sql

apply_all() {
  db=$1
  echo "==> $db"
  if [ "$(PGDATABASE="$db" psql -tAc "SELECT to_regclass('public.profiles') IS NOT NULL")" = "t" ]; then
    echo "    схема уже применена, миграции пропускаю"
  else
    for f in migrations/*.up.sql; do
      PGDATABASE="$db" psql -q -v ON_ERROR_STOP=1 -1 -f "$f"
    done
  fi
  PGDATABASE="$db" psql -q -v ON_ERROR_STOP=1 -f seeds/demo.sql
}

apply_all "$PGDATABASE"
if [ -n "$TEST_PGDATABASE" ]; then
  apply_all "$TEST_PGDATABASE"
fi

echo "==> готово: $PGUSER@$PGHOST:$PGPORT/$PGDATABASE"