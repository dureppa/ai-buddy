#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

path_for() {
  case "$1" in
    consents)    echo /api/v1/me/consents ;;
    documents)   echo /api/v1/me/documents ;;
    events)      echo /api/v1/me/events ;;
    absences)    echo /api/v1/me/absence-summary ;;
    trips)       echo /api/v1/me/travel-summary ;;
    hiring)      echo /api/v1/me/referral-summary ;;
    offboarding) echo /api/v1/me/offboarding ;;
    benefits)    echo /api/v1/me/benefit-summary ;;
    *) return 1 ;;
  esac
}

fail=0
for env_file in */.env; do
  [ -f "$env_file" ] || continue
  svc=$(basename "$(dirname "$env_file")")
  addr=$(set -a; . "./$env_file"; set +a; printf '%s' "${HTTP_ADDR:-}")
  path=$(path_for "$svc") || continue

  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost${addr}${path}" 2>/dev/null || true)
  [ -n "$code" ] || code=000

  if [ "$code" = "401" ]; then
    printf 'OK   %-12s %s%s -> 401 (слушает, требует токен)\n' "$svc" "$addr" "$path"
  else
    printf 'FAIL %-12s %s%s -> %s\n' "$svc" "$addr" "$path" "$code"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "==> есть нерабочие сервисы" >&2
  exit 1
fi
echo "==> все сервисы отвечают"