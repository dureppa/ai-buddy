#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
unset HTTP_ADDR DATABASE_URL SESSION_SECRET \
      PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE \
      PGADMIN_USER PGADMIN_PASSWORD


if [ $# -gt 0 ]; then
  SERVICES="$*"
else
  SERVICES=""
  for dir in */; do
    [ -f "$dir/go.mod" ] || continue
    SERVICES="$SERVICES $(basename "$dir")"
  done
fi

mkdir -p bin
pids=""
trap 'for p in $pids; do kill "$p" 2>/dev/null || true; done' INT TERM EXIT

for svc in $SERVICES; do
  if [ ! -f "$svc/go.mod" ]; then
    echo "нет $svc/go.mod — это не сервис" >&2
    exit 1
  fi
  if [ ! -f "$svc/.env" ]; then
    echo "==> $svc: нет .env, пропускаю" >&2
    continue
  fi

  addr=$(cd "$svc" && set -a && . .env && set +a && printf '%s' "${HTTP_ADDR:-}")

  echo "==> $svc: сборка"
  (cd "$svc" && go build -o "../bin/$svc" .)

  echo "==> $svc: запуск ${addr:-адрес из .env}"
  ENV_FILE="$svc/.env" "./bin/$svc" &
  pids="$pids $!"
done

if [ -z "$pids" ]; then
  echo "нечего запускать: не найден ни один сервис с go.mod и .env" >&2
  exit 1
fi

echo "==> все сервисы подняты, Ctrl+C для остановки"
wait