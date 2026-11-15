"""Detached deployment transaction. No external Python packages are required."""

import argparse
import base64
import fcntl
import gzip
import json
import os
import shutil
import subprocess
import tarfile
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from common import MAX_ARCHIVE, read_json, state_dir, status, validate_sha, write_json

SERVICES = (
    "agent",
    "go",
    "web",
    "hr-web",
    "hr-absences",
    "hr-trips",
    "hr-hiring",
    "hr-offboarding",
    "hr-consents",
    "hr-benefits",
    "hr-documents",
    "hr-events",
    "jira",
    "confluence",
    "tool-grafana",
)
COMPOSE = [
    "docker",
    "compose",
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.server.yml",
    "--profile",
    "hr",
]


def run(arguments: list[str], cwd: Path) -> str:
    return subprocess.check_output(arguments, cwd=cwd, text=True, stderr=None).strip()


def unpack(archive: Path, destination: Path) -> None:
    destination.mkdir(mode=0o700)
    with tarfile.open(archive, "r:") as bundle:
        members = bundle.getmembers()
        if len(members) > 10000 or sum(member.size for member in members) > MAX_ARCHIVE:
            raise ValueError("source archive exceeds limits")
        seen: set[str] = set()
        for member in members:
            path = Path(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or "\\" in member.name
                or len(member.name) > 1024
                or any(ord(char) < 32 for char in member.name)
                or member.name in seen
                or any(
                    part in {".git", ".deploy", "backups", "current"}
                    for part in path.parts
                )
                or any(
                    part == ".env"
                    or (part.startswith(".env.") and part != ".env.example")
                    for part in path.parts
                )
                or not (member.isfile() or member.isdir())
            ):
                raise ValueError("unsafe source member")
            seen.add(member.name)
        # Validate every member before writing any payload.
        for member in members:
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                source = bundle.extractfile(member)
                if source is None:
                    raise ValueError("missing file body")
                with source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    # Docker COPY preserves directory modes. Runtime Python uses a non-root UID,
    # so source directories must remain traversable even with the worker's umask 077.
    for directory in destination.rglob("*"):
        if directory.is_dir():
            directory.chmod(0o755)
    destination.chmod(0o755)
    for name in (
        "docker-compose.yml",
        "docker-compose.server.yml",
    ):
        if not (destination / name).is_file():
            raise ValueError("release is not server-ready")
    for nginx, agent in (
        ("ops/docker", "ai-agent"),
        ("docker", "services/ai-python"),
    ):
        if all(
            (destination / path).is_file()
            for path in (
                f"{nginx}/web.conf",
                f"{nginx}/hr-web.conf",
                f"{agent}/ai_buddy/deepseek.py",
            )
        ):
            break
    else:
        raise ValueError("release is not server-ready")
    if "ollama" in (destination / "docker-compose.yml").read_text().lower():
        raise ValueError("local model downloads are not allowed in CD")


def prepare(root: Path, sha: str) -> Path:
    releases = root / ".deploy" / "releases"
    releases.mkdir(exist_ok=True, mode=0o700)
    destination = releases / sha
    if not destination.exists():
        temporary = releases / (sha + ".incoming")
        if temporary.exists():
            shutil.rmtree(temporary)
        try:
            unpack(state_dir(root) / (sha + ".tar"), temporary)
            temporary.rename(destination)
        except Exception:
            shutil.rmtree(temporary, ignore_errors=True)
            raise
    for name, target in ((".env", root / ".env"), (".deploy", root / ".deploy")):
        link = destination / name
        if not link.is_symlink():
            link.symlink_to(target)
    return destination


def auth_configs(release: Path, root: Path) -> None:
    nginx = release / "ops/docker"
    if not nginx.is_dir():
        nginx = release / "docker"
    for name in ("web.conf", "hr-web.conf"):
        text = (nginx / name).read_text()
        if "server {" not in text:
            raise ValueError("missing nginx server")
        text = text.replace(
            "server {", "server {\n    include /etc/nginx/buddy-auth.conf;", 1
        )
        target = root / ".deploy" / name
        target.write_text(text)
        target.chmod(0o644)


def image_snapshot(release: Path) -> dict[str, str]:
    containers = run([*COMPOSE, "ps", "-aq"], release).split()
    images: dict[str, str] = {}
    for container in containers:
        name, identifier = run(
            [
                "docker",
                "inspect",
                container,
                "--format",
                "{{.Config.Image}} {{.Image}}",
            ],
            release,
        ).split()
        images[name] = identifier
    if not images:
        raise ValueError("no current images to preserve")
    return images


def backup_database(release: Path, directory: Path) -> None:
    container = run([*COMPOSE, "ps", "-q", "db"], release)
    if not container:
        raise ValueError("database is not running")
    dump_database(container, directory / "database.sql.gz")
    jira = run(
        [
            "docker",
            "ps",
            "-a",
            "--filter",
            "label=com.docker.compose.project=ai-buddy",
            "--filter",
            "label=com.docker.compose.service=jira-db",
            "--format",
            "{{.ID}}",
        ],
        release,
    )
    if jira:
        dump_database(jira, directory / "jira-database.sql.gz")


def dump_database(container: str, target: Path) -> None:
    process = subprocess.Popen(
        [
            "docker",
            "exec",
            container,
            "sh",
            "-c",
            'exec pg_dumpall -U "${POSTGRES_USER:-postgres}"',
        ],
        stdout=subprocess.PIPE,
    )
    assert process.stdout is not None
    with process.stdout, gzip.open(target, "wb") as output:
        shutil.copyfileobj(process.stdout, output)
    if process.wait() != 0:
        target.unlink(missing_ok=True)
        raise ValueError("database backup failed")
    target.chmod(0o600)


def http_request(
    path: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, str] | None = None,
    port: int = 80,
) -> tuple[int, Any, bytes]:
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}" + path,
        data=body,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.headers, response.read(65536)
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read(65536)


def verify_http(root: Path) -> None:
    code, headers, _ = http_request("/")
    if code != 401 or headers.get("Set-Cookie"):
        raise ValueError("public password gate failed")
    credentials = dict(
        line.split(": ", 1)
        for line in (root / ".deploy" / "access.txt").read_text().splitlines()
        if ": " in line
    )
    basic = base64.b64encode(
        (credentials["Username"] + ":" + credentials["Password"]).encode()
    ).decode()
    code, headers, _ = http_request("/", headers={"Authorization": "Basic " + basic})
    cookie = headers.get("Set-Cookie", "").split(";", 1)[0]
    if code != 200 or not cookie.startswith("ai_buddy_gate="):
        raise ValueError("password login failed")
    code, _, body = http_request(
        "/api/v1/demo/sessions",
        headers={"Cookie": cookie},
        payload={"profile_id": "olga"},
    )
    if code != 201:
        raise ValueError("demo session failed")
    token = json.loads(body)["access_token"]
    code, _, _ = http_request(
        "/api/v1/onboarding",
        headers={"Cookie": cookie, "Authorization": "Bearer " + token},
    )
    if code != 200:
        raise ValueError("API smoke failed")


def verify_jira(root: Path) -> None:
    code, _, _ = http_request("/", port=5189)
    if code != 401:
        raise ValueError("Jira password gate failed")
    credentials = dict(
        line.split(": ", 1)
        for line in (root / ".deploy" / "access.txt").read_text().splitlines()
        if ": " in line
    )
    basic = base64.b64encode(
        (credentials["Username"] + ":" + credentials["Password"]).encode()
    ).decode()
    code, headers, _ = http_request(
        "/", port=5189, headers={"Authorization": "Basic " + basic}
    )
    cookie = headers.get("Set-Cookie", "").split(";", 1)[0]
    if code != 200 or not cookie.startswith("ai_buddy_gate="):
        raise ValueError("Jira login failed")
    code, _, body = http_request(
        "/jira-api/v1/demo/sessions",
        port=5189,
        headers={"Cookie": cookie},
        payload={"profile_id": "olga"},
    )
    if code != 200:
        raise ValueError("Jira session failed")
    token = json.loads(body)["access_token"]
    code, _, body = http_request(
        "/jira-api/v1/me/issues",
        port=5189,
        headers={"Cookie": cookie, "Authorization": "Bearer " + token},
    )
    if code != 200 or not isinstance(json.loads(body), list):
        raise ValueError("Jira API failed")


def deploy(root: Path, sha: str) -> None:
    sha = validate_sha(sha)
    directory = state_dir(root)
    with (directory / "deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        status(root, sha, "running")
        current_file = directory / "current.json"
        previous = {"sha": "manual", "path": str(root)}
        previous_path = root
        snapshot: dict[str, str] = {}
        old_auth: dict[str, bytes] = {}
        switched = False
        try:
            if current_file.exists():
                previous = read_json(current_file)
                previous_path = Path(previous["path"])
                if not previous_path.resolve().is_relative_to(root.resolve()):
                    raise ValueError("previous release is outside deployment root")
            if shutil.disk_usage(root).free < 3 * 1024**3:
                raise ValueError("insufficient free disk")
            release = prepare(root, sha)
            snapshot = image_snapshot(previous_path)
            old_auth = {
                name: (root / ".deploy" / name).read_bytes()
                for name in ("web.conf", "hr-web.conf")
            }
            run([*COMPOSE, "config", "--quiet"], release)
            for service in SERVICES:
                status(root, sha, "building", service=service)
                subprocess.run(
                    [*COMPOSE, "build", service],
                    cwd=release,
                    check=True,
                    env={**os.environ, "COMPOSE_BAKE": "false"},
                )
            backups = (
                root
                / ".deploy"
                / "backups"
                / sha
                / datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
            )
            backups.mkdir(parents=True, exist_ok=True, mode=0o700)
            write_json(backups / "images.json", snapshot)
            backup_database(previous_path, backups)
            auth_configs(release, root)
            status(root, sha, "starting")
            switched = True
            run(
                [*COMPOSE, "up", "--no-build", "-d", "--wait", "--wait-timeout", "180"],
                release,
            )
            status(root, sha, "checking")
            verify_http(root)
            verify_jira(root)
            current = {
                "sha": sha,
                "path": str(release),
                "at": datetime.now(UTC).isoformat(),
            }
            write_json(current_file, current)
            pointer = root / ".current-next"
            pointer.unlink(missing_ok=True)
            pointer.symlink_to(release)
            pointer.replace(root / "current")
            status(root, sha, "ready")
        except Exception:
            status(root, sha, "rolling_back")
            try:
                for name, identifier in snapshot.items():
                    run(["docker", "tag", identifier, name], previous_path)
                for name, contents in old_auth.items():
                    target = root / ".deploy" / name
                    target.write_bytes(contents)
                    target.chmod(0o644)
                if switched:
                    run(
                        [
                            *COMPOSE,
                            "up",
                            "--no-build",
                            "-d",
                            "--force-recreate",
                            "--wait",
                            "--wait-timeout",
                            "180",
                        ],
                        previous_path,
                    )
                    verify_http(root)
                    write_json(current_file, previous)
                    rollback_pointer = root / ".current-next"
                    rollback_pointer.unlink(missing_ok=True)
                    rollback_pointer.symlink_to(previous_path)
                    rollback_pointer.replace(root / "current")
            except Exception:
                status(root, sha, "rollback_failed")
                raise
            status(root, sha, "failed")
            raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        deploy(args.root.resolve(), args.sha)
        return 0
    except Exception as error:  # noqa: BLE001 -- process boundary never publishes provider or secret data
        print("Deployment stopped:", type(error).__name__, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
