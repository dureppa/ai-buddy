#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."
project="ai-buddy-external-check-$$"
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-4}"

compose() {
  docker compose -p "$project" --profile hr --profile jira "$@"
}

cleanup() {
  compose down --volumes
}
trap cleanup EXIT

hr="hr-absences hr-trips hr-hiring hr-offboarding hr-consents hr-benefits hr-documents hr-events"
tools=$(compose config --services | sed -n '/^tool-/p')
# The Go API containers for the 13 tools share one executable image.
compose build tool-grafana hr-web access confluence jira go $hr
compose up -d --no-build --wait --wait-timeout 180 hr-web access confluence jira $hr $tools

services=$(compose ps --services --status running)
for service in $services; do
  case "$service" in
    go|web|agent|mcp)
      echo "Buddy container $service started during the standalone check" >&2
      exit 1
      ;;
  esac
done
python3 ops/checks/check-corporate-services.py
python3 ops/checks/check-work-tools.py
compose exec -T db psql -U aibuddy -d aibuddy -v ON_ERROR_STOP=1 < ops/checks/check-database-isolation.sql

compose up -d --no-build --wait --wait-timeout 120 go
compose exec -T go sh -s <<'BUDDY'
set -eu
origin=http://127.0.0.1:8080
session=$(wget -q -O - --header='Content-Type: application/json' --post-data='{"profile_id":"sasha"}' "$origin/api/v1/demo/sessions")
token=$(printf '%s' "$session" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
test -n "$token"
for path in confluence/pages portal-access/catalog work-tools/grafana; do
  wget -q -O /dev/null --header="Authorization: Bearer $token" "$origin/api/v1/$path"
  echo "Buddy HTTP integration with $path passed"
done
BUDDY
