#!/bin/sh
set -eu

if ! command -v python3 >/dev/null 2>&1; then
    printf '%s\n' 'load_test: Python 3.10+ is required to prepare local tools.' >&2
    exit 2
fi
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
    printf '%s\n' 'load_test: Python 3.10+ is required to prepare local tools.' >&2
    exit 2
fi
project_root=$(CDPATH= cd "$(dirname "$0")" && pwd)
exec python3 "$project_root/ai-agent/load_bootstrap.py" "$@"
