#!/bin/sh
set -eu

usage() {
    printf '%s\n' 'Usage: sh load-test.sh [requests=120] [workers=8]' \
        'Requires Docker Engine/Desktop; image builds may download dependencies.' \
        'Runs frontend, Go and Python load tests with no runtime network.' \
        'Optional: LOAD_HISTORY=40 (1..1000 messages).'
}

fail() {
    printf 'load-test: %s\n' "$1" >&2
    exit 2
}

positive_integer() {
    case "$2" in ''|*[!0-9]*) fail "$1 must be an integer in [1, $3]" ;; esac
    # Reject oversized numbers before passing them to the shell integer parser.
    [ "${#2}" -le 6 ] || fail "$1 must be an integer in [1, $3]"
    [ "$2" -ge 1 ] && [ "$2" -le "$3" ] || fail "$1 must be an integer in [1, $3]"
}

case "${1-}" in -h|--help) usage; exit 0 ;; esac
[ "$#" -le 2 ] || fail 'expected at most two arguments; use --help'
requests=${1-${LOAD_REQUESTS-120}}
workers=${2-${LOAD_WORKERS-8}}
history=${LOAD_HISTORY-40}
positive_integer LOAD_REQUESTS "$requests" 100000
positive_integer LOAD_WORKERS "$workers" 256
positive_integer LOAD_HISTORY "$history" 1000

command -v docker >/dev/null 2>&1 || fail 'Docker is not installed. Install Docker Engine or Docker Desktop.'
docker info >/dev/null 2>&1 || fail 'Docker is unavailable. Start Docker and check access with docker info.'

project_root=$(CDPATH= cd "$(dirname "$0")" && pwd)
image=ai-buddy-load-tests:local
printf '%s\n' 'Preparing the load-test image (dependencies are cached by Docker)...'
docker build --file "$project_root/ops/docker/Dockerfile.load" --tag "$image" "$project_root"
printf 'Running offline load tests: requests=%s workers=%s history=%s\n' "$requests" "$workers" "$history"
exec docker run --rm --network=none \
    --env "LOAD_REQUESTS=$requests" \
    --env "LOAD_WORKERS=$workers" \
    --env "LOAD_HISTORY=$history" \
    "$image"
