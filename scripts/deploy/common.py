"""Small shared types for the server's stdlib-only deployment tools."""

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MAX_ARCHIVE = 64 * 1024 * 1024


def validate_sha(value: str) -> str:
    if re.fullmatch(r"[0-9a-f]{40}", value) is None:
        raise ValueError("invalid deployment SHA")
    return value


def state_dir(root: Path) -> Path:
    directory = root / ".deploy" / "cd"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    return directory


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise TypeError("invalid state")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, sort_keys=True) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def status(root: Path, sha: str, phase: str, **details: Any) -> dict[str, Any]:
    value = {
        "sha": validate_sha(sha),
        "phase": phase,
        "at": datetime.now(UTC).isoformat(),
        **details,
    }
    write_json(state_dir(root) / (sha + ".json"), value)
    return value
