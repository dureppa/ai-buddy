"""Deployment boundaries and transaction outcomes; no SSH, Docker or LLM needed."""

import importlib.util
import io
import subprocess
import sys
import tarfile
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any
from unittest.mock import Mock

import pytest
import yaml

SCRIPTS = Path(__file__).resolve().parents[2] / "ops" / "deploy"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / (name + ".py"))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


common = load("common")
worker = load("worker")
dispatcher = load("dispatcher")
check_ci = load("check_ci")
SHA = "a" * 40


def archive(
    path: Path,
    extra: list[tuple[str, bytes, bytes]] | None = None,
    *,
    model: str = "deepseek",
    nginx: str = "ops/docker",
    agent: str = "ai-agent",
) -> Path:
    entries = [
        ("docker-compose.yml", model.encode(), tarfile.REGTYPE),
        ("docker-compose.server.yml", b"services: {}", tarfile.REGTYPE),
        (f"{nginx}/web.conf", b"server {\n}\n", tarfile.REGTYPE),
        (f"{nginx}/hr-web.conf", b"server {\n}\n", tarfile.REGTYPE),
        (f"{agent}/ai_buddy/deepseek.py", b"# provider", tarfile.REGTYPE),
        *(extra or []),
    ]
    with tarfile.open(path, "w") as bundle:
        for name, content, kind in entries:
            member = tarfile.TarInfo(name)
            member.size = len(content)
            member.type = kind
            member.linkname = "../outside"
            bundle.addfile(member, io.BytesIO(content))
    return path


def test_legacy_release_supports_rollback(tmp_path: Path) -> None:
    bundle = archive(tmp_path / "old.tar", nginx="docker", agent="services/ai-python")
    release = tmp_path / "previous"
    worker.unpack(bundle, release)
    (tmp_path / ".deploy").mkdir()
    worker.auth_configs(release, tmp_path)
    for name in ("web.conf", "hr-web.conf"):
        assert (
            "include /etc/nginx/buddy-auth.conf;"
            in (tmp_path / ".deploy" / name).read_text()
        )


def test_ci_gate_requires_all_jobs_once() -> None:
    jobs = [
        {"name": name, "status": "completed", "conclusion": "success"}
        for name in check_ci.REQUIRED
    ]
    check_ci.check_jobs({"jobs": jobs, "total_count": 4})
    for malformed in (
        {},
        {"jobs": jobs, "total_count": 5},
        {"jobs": jobs[:-1], "total_count": 3},
        {"jobs": jobs + [jobs[0]], "total_count": 5},
    ):
        with pytest.raises((TypeError, ValueError)):
            check_ci.check_jobs(malformed)
    jobs[0]["conclusion"] = "skipped"
    with pytest.raises(ValueError):
        check_ci.check_jobs({"jobs": jobs, "total_count": 4})


@pytest.mark.parametrize(
    "name,kind",
    [
        ("../outside", tarfile.REGTYPE),
        ("/etc/outside", tarfile.REGTYPE),
        (".env", tarfile.REGTYPE),
        ("ai-agent/.env", tarfile.REGTYPE),
        (".deploy/access.txt", tarfile.REGTYPE),
        ("backups/database.sql", tarfile.REGTYPE),
        ("linked", tarfile.SYMTYPE),
        ("hardlink", tarfile.LNKTYPE),
        ("pipe", tarfile.FIFOTYPE),
    ],
)
def test_archive_rejects_secrets_traversal_and_special_files(
    tmp_path: Path, name: str, kind: bytes
) -> None:
    source = archive(tmp_path / "source.tar", [(name, b"secret", kind)])
    with pytest.raises(ValueError):
        worker.unpack(source, tmp_path / "release")
    assert not (tmp_path / "outside").exists()


def test_prepare_links_persistent_secrets_and_blocks_model_download(
    tmp_path: Path,
) -> None:
    state = common.state_dir(tmp_path)
    archive(state / (SHA + ".tar"))
    release = worker.prepare(tmp_path, SHA)
    assert (release / ".env").is_symlink()
    assert (release / "ai-agent/ai_buddy").stat().st_mode & 0o777 == 0o755
    assert (release / ".deploy").readlink() == tmp_path / ".deploy"
    assert worker.prepare(tmp_path, SHA) == release
    worker.auth_configs(release, tmp_path)
    assert (
        "include /etc/nginx/buddy-auth.conf;"
        in (tmp_path / ".deploy/web.conf").read_text()
    )
    bad = "b" * 40
    archive(state / (bad + ".tar"), model="ollama")
    with pytest.raises(ValueError):
        worker.prepare(tmp_path, bad)
    assert not (tmp_path / ".deploy/releases" / (bad + ".incoming")).exists()
    with pytest.raises(FileExistsError):
        worker.unpack(
            archive(tmp_path / "large.tar", [("x", b"a", tarfile.REGTYPE)]), release
        )


def test_dispatch_is_restricted_bounded_and_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for command in (
        "",
        "bash",
        "deploy ../bad",
        "deploy " + SHA + "; id",
        "status " + "A" * 40,
    ):
        with pytest.raises(ValueError):
            dispatcher.parse_command(command)
    assert (
        dispatcher.dispatch(tmp_path, "status " + SHA, io.BytesIO())["phase"]
        == "unknown"
    )
    popen = Mock(return_value=SimpleNamespace(pid=123))
    monkeypatch.setattr(dispatcher.subprocess, "Popen", popen)
    result = dispatcher.dispatch(tmp_path, "deploy " + SHA, io.BytesIO(b"tar-data"))
    assert result["phase"] == "accepted"
    assert popen.call_args.kwargs["start_new_session"] is True
    common.status(tmp_path, SHA, "ready")
    body = io.BytesIO(b"repeat-archive")
    assert dispatcher.dispatch(tmp_path, "deploy " + SHA, body)["phase"] == "ready"
    assert body.read() == b""  # Do not SIGPIPE git archive on a retry.
    assert popen.call_count == 1
    monkeypatch.setattr(dispatcher, "MAX_ARCHIVE", 4)
    with pytest.raises(ValueError):
        dispatcher.receive(io.BytesIO(b"12345"), tmp_path / "too-large")
    with pytest.raises(ValueError):
        dispatcher.receive(io.BytesIO(), tmp_path / "empty")


def test_deploy_success_and_failure_keep_the_expected_release(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("web.conf", "hr-web.conf"):
        p = tmp_path / ".deploy" / name
        p.parent.mkdir(exist_ok=True)
        p.write_text("old-config")
    directory = common.state_dir(tmp_path)
    archive(directory / (SHA + ".tar"))
    calls: list[list[str]] = []
    failure = {"mode": "none"}

    def command(args: list[str], cwd: Path) -> str:
        calls.append(args)
        if "up" in args and "--force-recreate" not in args and failure["mode"] == "up":
            raise subprocess.CalledProcessError(1, args)
        return ""

    monkeypatch.setattr(worker, "run", command)
    monkeypatch.setattr(worker, "image_snapshot", lambda _: {"image:latest": "old-id"})
    monkeypatch.setattr(worker, "backup_database", lambda *_: None)
    monkeypatch.setattr(worker, "verify_http", lambda _: None)
    monkeypatch.setattr(worker, "verify_jira", lambda _: None)
    monkeypatch.setattr(
        worker.shutil, "disk_usage", lambda _: SimpleNamespace(free=10 * 1024**3)
    )

    def build(*args: Any, **kwargs: Any) -> None:
        if failure["mode"] == "build":
            raise subprocess.CalledProcessError(1, args[0])

    monkeypatch.setattr(worker.subprocess, "run", build)
    worker.deploy(tmp_path, SHA)
    release = tmp_path / ".deploy/releases" / SHA
    assert common.read_json(directory / "current.json")["path"] == str(release)
    assert common.read_json(directory / (SHA + ".json"))["phase"] == "ready"
    assert (tmp_path / "current").readlink() == release
    for mode, sha in (("build", "b" * 40), ("up", "c" * 40)):
        failure["mode"] = mode
        archive(directory / (sha + ".tar"))
        with pytest.raises(subprocess.CalledProcessError):
            worker.deploy(tmp_path, sha)
        assert common.read_json(directory / (sha + ".json"))["phase"] == "failed"
        assert common.read_json(directory / "current.json")["sha"] == SHA
        assert (tmp_path / "current").readlink() == release
        assert ["docker", "tag", "old-id", "image:latest"] in calls
    assert any("--force-recreate" in args for args in calls)


def test_workflow_only_deploys_verified_pushes_and_pins_ssh() -> None:
    root = SCRIPTS.parents[1]
    text = (root / ".github/workflows/deploy.yml").read_text()
    config = yaml.safe_load(text)
    assert config["concurrency"]["cancel-in-progress"] is False
    assert config["permissions"] == {"contents": "read", "actions": "read"}
    condition = config["jobs"]["deploy"]["if"]
    for required in ("'success'", "'push'", "'main'", "head_repository.full_name"):
        assert required in condition
    sender = (SCRIPTS / "send.sh").read_text()
    assert "StrictHostKeyChecking=yes" in sender and "git archive" in sender
    assert "workflow_run.head_sha" in text and "ops/deploy/check_ci.py" in text


def test_image_snapshot_and_database_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def command(args: list[str], cwd: Path) -> str:
        if "-aq" in args:
            return "container-one\ncontainer-two"
        if args[:2] == ["docker", "inspect"]:
            return "image:latest sha256:old"
        return "database-container"

    monkeypatch.setattr(worker, "run", command)
    assert worker.image_snapshot(tmp_path) == {"image:latest": "sha256:old"}
    process = Mock(stdout=io.BytesIO(b"-- database snapshot\n"))
    process.wait.return_value = 0

    def start_dump(*args: Any, **kwargs: Any) -> Mock:
        process.stdout = io.BytesIO(b"-- database snapshot\n")
        return process

    monkeypatch.setattr(worker.subprocess, "Popen", start_dump)
    worker.backup_database(tmp_path, tmp_path)
    import gzip

    assert (
        gzip.decompress((tmp_path / "database.sql.gz").read_bytes())
        == b"-- database snapshot\n"
    )
    assert (tmp_path / "jira-database.sql.gz").exists()
    process.stdout = io.BytesIO(b"partial")
    process.wait.return_value = 1
    with pytest.raises(ValueError):
        worker.backup_database(tmp_path, tmp_path)
    assert not (tmp_path / "database.sql.gz").exists()


def test_http_smoke_requires_password_cookie_and_bearer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".deploy").mkdir()
    (tmp_path / ".deploy/access.txt").write_text(
        "Username: buddy\nPassword: synthetic-test-password\n"
    )
    responses = [
        (401, {}, b""),
        (200, {"Set-Cookie": "ai_buddy_gate=test; HttpOnly"}, b""),
        (201, {}, b'{"access_token":"intern-test-token"}'),
        (200, {}, b"{}"),
    ]
    calls: list[dict[str, Any]] = []

    def request(path: str, **kwargs: Any) -> tuple[int, dict[str, str], bytes]:
        calls.append(kwargs)
        return responses[len(calls) - 1]

    monkeypatch.setattr(worker, "http_request", request)
    worker.verify_http(tmp_path)
    assert calls[-1]["headers"]["Authorization"] == "Bearer intern-test-token"
    assert calls[-1]["headers"]["Cookie"] == "ai_buddy_gate=test"
    calls.clear()
    responses[0] = (401, {"Set-Cookie": "ai_buddy_gate=leaked"}, b"")
    with pytest.raises(ValueError):
        worker.verify_http(tmp_path)
    calls.clear()
    responses[0] = (401, {}, b"")
    responses[1] = (200, {}, b"")
    with pytest.raises(ValueError):
        worker.verify_http(tmp_path)


def test_rollback_failure_is_distinct_and_state_corruption_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    state = common.state_dir(tmp_path)
    current = state / "current.json"
    current.write_text("[]")
    with pytest.raises(TypeError):
        worker.deploy(tmp_path, SHA)
    assert common.read_json(state / (SHA + ".json"))["phase"] == "failed"
    current.unlink()
    archive(state / (SHA + ".tar"))
    for name in ("web.conf", "hr-web.conf"):
        (tmp_path / ".deploy" / name).write_text("old")
    monkeypatch.setattr(
        worker.shutil, "disk_usage", lambda _: SimpleNamespace(free=10 * 1024**3)
    )
    monkeypatch.setattr(worker, "image_snapshot", lambda _: {"image:latest": "old-id"})
    monkeypatch.setattr(worker, "backup_database", lambda *_: None)
    monkeypatch.setattr(worker.subprocess, "run", lambda *args, **kwargs: None)

    def command(args: list[str], cwd: Path) -> str:
        if "up" in args:
            raise subprocess.CalledProcessError(1, args)
        return ""

    monkeypatch.setattr(worker, "run", command)
    with pytest.raises(subprocess.CalledProcessError):
        worker.deploy(tmp_path, SHA)
    assert common.read_json(state / (SHA + ".json"))["phase"] == "rollback_failed"


def test_jira_smoke_checks_gate_session_and_tasks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".deploy").mkdir()
    (tmp_path / ".deploy/access.txt").write_text("Username: buddy\nPassword: test\n")
    good = [
        (401, {}, b""),
        (200, {"Set-Cookie": "ai_buddy_gate=test; HttpOnly"}, b""),
        (200, {}, b'{"access_token":"jira-token"}'),
        (200, {}, b"[]"),
    ]
    replies = good.copy()
    calls: list[dict[str, Any]] = []

    def request(path: str, **kwargs: Any) -> tuple[int, dict[str, str], bytes]:
        calls.append(kwargs)
        return replies[len(calls) - 1]

    monkeypatch.setattr(worker, "http_request", request)
    worker.verify_jira(tmp_path)
    assert all(call["port"] == 5189 for call in calls)
    assert calls[-1]["headers"]["Authorization"] == "Bearer jira-token"
    assert calls[-1]["headers"]["Cookie"] == "ai_buddy_gate=test"
    cases: list[tuple[int, tuple[int, dict[str, str], bytes]]] = [
        (0, (200, {}, b"")),
        (1, (200, {}, b"")),
        (2, (503, {}, b"")),
        (3, (200, {}, b"{}")),
    ]
    for index, replacement in cases:
        calls.clear()
        replies = good.copy()
        replies[index] = replacement
        with pytest.raises(ValueError):
            worker.verify_jira(tmp_path)


def test_first_deploy_has_no_jira_database_to_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(worker, "run", lambda args, cwd: "db" if "-q" in args else "")
    dumps: list[Path] = []
    monkeypatch.setattr(
        worker, "dump_database", lambda container, target: dumps.append(target)
    )
    worker.backup_database(tmp_path, tmp_path)
    assert dumps == [tmp_path / "database.sql.gz"]
