#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."
export JIRA_TEST_DATABASE_URL="${JIRA_TEST_DATABASE_URL:-${TEST_DATABASE_URL:-}}"
for module in corporate-services/* tools tools/jira; do
  [ -f "$module/go.mod" ] || continue
  printf '%s\n' "Checking $module"
  (
    cd "$module"
    unformatted=$(gofmt -l .)
    if [ -n "$unformatted" ]; then
      printf '%s\n' "$unformatted" >&2
      exit 1
    fi
    go vet ./...
    go test -race ./...
  )
done
