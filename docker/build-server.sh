#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
trap 'echo failed > .deploy/status' EXIT
export COMPOSE_BAKE=false
for service in agent go web hr-web hr-absences hr-trips hr-hiring hr-offboarding hr-consents hr-benefits; do
  echo "building:$service" > .deploy/status
  echo "Building $service"
  docker compose -f docker-compose.yml -f docker-compose.server.yml --profile hr build "$service"
done
echo starting > .deploy/status
docker compose -f docker-compose.yml -f docker-compose.server.yml --profile hr up --no-build -d --wait --wait-timeout 180
echo ready > .deploy/status
trap - EXIT
