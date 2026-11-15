"""Forced SSH command: receive a bounded source archive or read safe status."""

import argparse
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
from pathlib import Path
from typing import BinaryIO

from common import MAX_ARCHIVE, read_json, state_dir, status, validate_sha


def parse_command(value: str) -> tuple[str, str]:
    match = re.fullmatch(r"(deploy|status) ([0-9a-f]{40})", value)
    if match is None:
        raise ValueError("only deploy/status with a full SHA is permitted")
    return match[1], validate_sha(match[2])


def receive(source: BinaryIO, target: Path) -> None:
    size = 0
    with target.open("wb") as output:
        while chunk := source.read(65536):
            size += len(chunk)
            if size > MAX_ARCHIVE:
                raise ValueError("source archive too large")
            output.write(chunk)
    if size == 0:
        raise ValueError("empty source archive")


def dispatch(root: Path, command: str, source: BinaryIO) -> dict[str, object]:
    action, sha = parse_command(command)
    directory = state_dir(root)
    record = directory / (sha + ".json")
    if action == "status":
        value = (
            read_json(record) if record.exists() else {"sha": sha, "phase": "unknown"}
        )
        return {"sha": sha, "phase": value["phase"]}
    # Each SHA is admitted once; a detached worker has its own global deploy lock.
    with (directory / (sha + ".lock")).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if record.exists():
            previous = read_json(record)
            if previous["phase"] not in {"failed", "rollback_failed", "unknown"}:
                receive(source, Path("/dev/null"))
                return {"sha": sha, "phase": previous["phase"]}
        archive = directory / (sha + ".tar")
        signal.alarm(180)
        try:
            receive(source, archive)
        finally:
            signal.alarm(0)
        status(root, sha, "accepted")
        try:
            with (directory / (sha + ".log")).open("ab") as log:
                process = subprocess.Popen(
                    [
                        sys.executable,
                        "-u",
                        str(Path(__file__).with_name("worker.py")),
                        "--root",
                        str(root),
                        "--sha",
                        sha,
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                    close_fds=True,
                )
            return {"sha": sha, "phase": "accepted", "pid": process.pid}
        except OSError:
            status(root, sha, "failed")
            raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = dispatch(
            args.root.resolve(),
            os.environ.get("SSH_ORIGINAL_COMMAND", ""),
            sys.stdin.buffer,
        )
        print(json.dumps(result))
        return 0
    except (TypeError, ValueError, OSError):
        print('{"phase":"failed","message":"Deployment request rejected"}')
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
