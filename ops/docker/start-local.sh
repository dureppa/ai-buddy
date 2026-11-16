#!/bin/sh
# Build one service at a time: Compose 5 can ignore COMPOSE_PARALLEL_LIMIT for builds.
set -eu
cd "$(dirname "$0")/../.."

compose() {
  docker compose --profile hr --profile jira "$@"
}

if [ "$#" -gt 1 ]; then
  echo "Usage: sh ops/docker/start-local.sh [--parallel]" >&2
  exit 2
fi
mode=${1:-}
case "$mode" in
  ""|--parallel) ;;
  --help|-h) echo "Usage: sh ops/docker/start-local.sh [--parallel]"; exit 0 ;;
  *) echo "Unknown option: $mode" >&2; exit 2 ;;
esac

docker info >/dev/null
compose config --quiet
if [ "$mode" = --parallel ]; then
  compose build
else
  services=$(compose config --services)
  for service in $services; do
    compose build "$service"
  done
fi
compose up -d --no-build --wait --wait-timeout 900
