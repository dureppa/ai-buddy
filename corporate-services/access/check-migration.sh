#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."
project=ai-buddy-access-rollback-$$
compose() { docker compose -p "$project" "$@"; }
trap 'compose down --volumes' EXIT
compose up -d --wait --wait-timeout 90 db
compose run --rm --no-deps migrate
compose exec -T db psql -U aibuddy -d aibuddy -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO portal_resources VALUES ('delivery','dwh','delivery.orders_mart','{}');
INSERT INTO portal_access_requests
(profile_id,product_id,template_id,resource_key,permission,scope_key,input,operation_key,origin)
VALUES ('olga','delivery','dwh','delivery.orders_mart','read','resource','{}','legacy','portal');
SQL
compose run --rm access-migrate
compose exec -T db psql -U aibuddy -d buddy_access -v ON_ERROR_STOP=1 <<'SQL'
UPDATE portal_access_requests SET status='cancelled' WHERE operation_key='legacy';
INSERT INTO portal_access_requests
(profile_id,product_id,template_id,resource_key,permission,scope_key,input,operation_key,origin)
VALUES ('olga','delivery','dwh','delivery.orders_mart','read','resource','{}','new','portal');
SQL
compose run --rm --no-deps --entrypoint sh access-migrate /data/rollback.sh
check=$(compose exec -T db psql -U aibuddy -d aibuddy -At -c "SELECT string_agg(number||':'||status, ',' ORDER BY number) FROM portal_access_requests")
test "$check" = "1:cancelled,2:submitted"
compose run --rm access-migrate
check=$(compose exec -T db psql -U aibuddy -d buddy_access -At -c "SELECT string_agg(number||':'||status, ',' ORDER BY number) FROM portal_access_requests")
test "$check" = "1:cancelled,2:submitted"
echo "Access migration, rollback and renewed migration passed"
