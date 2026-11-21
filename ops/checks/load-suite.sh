#!/bin/sh
set -eu

project_root=$(CDPATH= cd "$(dirname "$0")/../.." && pwd)
cd "$project_root"

printf '%s\n' 'Frontend load tests'
npm run test:load --workspace=@ai-buddy/web

printf '%s\n' 'Go load tests'
(
    cd web/backend
    go test ./internal/httpapi -run '^TestBackendLoad$' -count=1 -v -timeout=10m
)

printf '%s\n' 'Python load tests'
(
    cd ai-agent
    uv run --locked pytest tests/test_load.py -q -s
)
