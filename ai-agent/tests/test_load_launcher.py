"""Exercise the executable native launcher and verified tool cache offline."""

import fcntl
import hashlib
import io
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

import pytest

import load_bootstrap as bootstrap

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def checkout(tmp_path: Path) -> Path:
    root = tmp_path / "fresh checkout with spaces"
    for relative in (
        "load_test.sh",
        "ai-agent/load_bootstrap.py",
        "ops/checks/load-suite.sh",
    ):
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, target)
        target.chmod(0o755)
    (root / "web/backend").mkdir(parents=True)
    (root / ".nvmrc").write_text("24.22.2\n")
    (root / "web/backend/go.mod").write_text("module fixture\n\ngo 1.26.11\n")
    (root / "web/backend/go.sum").write_text("fixture\n")
    (root / "package-lock.json").write_text("{}")
    (root / "package.json").write_text(
        json.dumps({"packageManager": "npm@11.19.1", "workspaces": ["web"]})
    )
    (root / "web/package.json").write_text("{}")
    return root


@pytest.fixture
def prepared(checkout: Path) -> Path:
    cache = checkout / ".load-tools"
    cache.mkdir()
    script = (
        f"#!{sys.executable}\n"
        + """
import json
import os
import sys
from pathlib import Path
name, args = Path(sys.argv[0]).name, sys.argv[1:]
record = {"name": name, "args": args, "cwd": os.getcwd(),
          "load": {key: os.environ.get(key) for key in
                   ("LOAD_REQUESTS", "LOAD_WORKERS", "LOAD_HISTORY", "UV_OFFLINE", "GOPROXY")},
          "has_model_key": "DEEPSEEK_API_KEY" in os.environ,
          "go_root": os.environ.get("GOROOT")}
with open(os.environ["CALL_LOG"], "a") as stream:
    stream.write(json.dumps(record) + "\\n")
if (name + " " + args[0]) == os.environ.get("FAIL_STAGE"):
    sys.exit(19)
if name == "npm" and args[0] == "ci":
    path = Path("node_modules/.bin/vitest")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()
if name == "go" and args[0] == "mod":
    Path(os.environ["GOMODCACHE"]).mkdir(parents=True, exist_ok=True)
"""
    )
    for tool in bootstrap.tool_plan(checkout, platform.system(), platform.machine()):
        home = cache / tool.archive.removesuffix(".tar.gz").removesuffix(".whl")
        command = home / tool.executable
        command.parent.mkdir(parents=True)
        command.write_text(script)
        command.chmod(0o755)
        if tool.name == "node":
            package = home / "lib/node_modules/npm/package.json"
            package.parent.mkdir(parents=True)
            package.write_text('{"version":"11.19.1"}')
            shutil.copyfile(command, home / "bin/npm")
            (home / "bin/npm").chmod(0o755)
    return checkout


def launch(
    root: Path, args: list[str], **updates: str
) -> tuple[subprocess.CompletedProcess[str], list[dict[str, Any]]]:
    log = root / "calls.jsonl"
    log.unlink(missing_ok=True)
    result = subprocess.run(
        [str(root / "load_test.sh"), *args],
        cwd=root.parent,
        env={
            **os.environ,
            "PATH": "/usr/bin:/bin",
            "CALL_LOG": str(log),
            "DEEPSEEK_API_KEY": "do-not-pass-real-keys",
            "LOAD_HISTORY": "1",
            **updates,
        },
        text=True,
        capture_output=True,
        check=False,
        timeout=20,
    )
    return result, [
        json.loads(line) for line in log.read_text().splitlines()
    ] if log.exists() else []


def test_executable_launcher_prepares_and_reuses_dependencies(prepared: Path) -> None:
    result, calls = launch(prepared, [])
    assert result.returncode == 0, result.stderr
    assert [(call["name"], call["args"][0]) for call in calls] == [
        ("npm", "ci"),
        ("uv", "sync"),
        ("go", "mod"),
        ("npm", "run"),
        ("go", "test"),
        ("uv", "run"),
    ]
    assert not any(call["has_model_key"] for call in calls)
    assert all(
        Path(call["go_root"]).is_relative_to(prepared / ".load-tools") for call in calls
    )
    assert all(call["load"]["UV_OFFLINE"] == "1" for call in calls[-3:])
    assert all(call["load"]["GOPROXY"] == "off" for call in calls[-3:])
    assert all(call["load"]["LOAD_REQUESTS"] == "120" for call in calls[-3:])
    result, calls = launch(prepared, ["4", "256"])
    assert result.returncode == 0, result.stderr
    assert [(call["name"], call["args"][0]) for call in calls] == [
        ("uv", "sync"),
        ("npm", "run"),
        ("go", "test"),
        ("uv", "run"),
    ]
    assert all(call["load"]["LOAD_REQUESTS"] == "4" for call in calls[-3:])
    assert all(call["load"]["LOAD_WORKERS"] == "256" for call in calls[-3:])
    (prepared / "package-lock.json").write_text('{"changed":true}')
    (prepared / "web/backend/go.sum").write_text("updated")
    result, calls = launch(prepared, ["1", "1"])
    assert result.returncode == 0
    assert [(call["name"], call["args"][0]) for call in calls[:3]] == [
        ("npm", "ci"),
        ("uv", "sync"),
        ("go", "mod"),
    ]


@pytest.mark.parametrize(
    "stage", ["npm ci", "uv sync", "go mod", "npm run", "go test", "uv run"]
)
def test_failures_stop_and_propagate(prepared: Path, stage: str) -> None:
    result, calls = launch(prepared, ["1", "2"], FAIL_STAGE=stage)
    assert result.returncode == 19, result.stderr
    assert calls[-1]["name"] + " " + calls[-1]["args"][0] == stage


@pytest.mark.parametrize(
    "args, update",
    [
        (["0"], {}),
        (["100001"], {}),
        (["9999999999999999999999"], {}),
        (["-1"], {}),
        (["1.5"], {}),
        ([""], {}),
        (["1", "257"], {}),
        (["1", "0"], {}),
        (["1", "2", "3"], {}),
        ([], {"LOAD_HISTORY": "1001"}),
        ([], {"LOAD_REQUESTS": "bad"}),
    ],
)
def test_invalid_parameters_do_not_prepare(
    checkout: Path, args: list[str], update: dict[str, str]
) -> None:
    result, calls = launch(checkout, args, **update)
    assert result.returncode == 2
    assert not calls
    assert not (checkout / ".load-tools").exists()


def test_environment_defaults_and_argument_precedence(prepared: Path) -> None:
    result, calls = launch(prepared, ["4"], LOAD_REQUESTS="9", LOAD_WORKERS="3")
    assert result.returncode == 0, result.stderr
    assert calls[-1]["load"]["LOAD_REQUESTS"] == "4"
    assert calls[-1]["load"]["LOAD_WORKERS"] == "3"


def test_help_and_lock(prepared: Path) -> None:
    result, calls = launch(prepared, ["--help"])
    assert result.returncode == 0 and "No Docker" in result.stdout
    assert not calls
    with (prepared / ".load-tools/launcher.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result, calls = launch(prepared, [])
    assert result.returncode == 2 and "Another load_test.sh" in result.stderr
    assert not calls


def test_main_prepares_local_environment_in_process(
    prepared: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        bootstrap, "__file__", str(prepared / "ai-agent/load_bootstrap.py")
    )
    monkeypatch.setenv("CALL_LOG", str(prepared / "direct.jsonl"))
    monkeypatch.setenv("LOAD_HISTORY", "1")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "do-not-pass-real-keys")
    assert bootstrap.main(["1", "2"]) == 0
    calls = [
        json.loads(line)
        for line in (prepared / "direct.jsonl").read_text().splitlines()
    ]
    assert calls[-1]["name"] == "uv"
    assert not any(call["has_model_key"] for call in calls)
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    assert bootstrap.main(["1", "2"]) == 2


@pytest.mark.parametrize(
    "system, machine, node_tag, go_tag, uv_tag",
    [
        ("Linux", "x86_64", "linux-x64", "linux-amd64", "manylinux_2_17_x86_64"),
        ("Linux", "aarch64", "linux-arm64", "linux-arm64", "manylinux_2_17_aarch64"),
        ("Darwin", "x86_64", "darwin-x64", "darwin-amd64", "macosx_10_12_x86_64"),
        ("Darwin", "arm64", "darwin-arm64", "darwin-arm64", "macosx_11_0_arm64"),
    ],
)
def test_platform_plan(
    checkout: Path, system: str, machine: str, node_tag: str, go_tag: str, uv_tag: str
) -> None:
    node, go, uv = bootstrap.tool_plan(checkout, system, machine)
    assert node_tag in node.archive and "24.22.2" in node.archive
    assert go_tag in go.archive and "1.26.11" in go.archive
    assert uv_tag in uv.archive


def test_unsupported_platform_and_invalid_versions(checkout: Path) -> None:
    with pytest.raises(bootstrap.BootstrapError, match="Supported hosts"):
        bootstrap.tool_plan(checkout, "Windows", "AMD64")
    (checkout / ".nvmrc").write_text("../../outside")
    with pytest.raises(bootstrap.BootstrapError, match="pinned"):
        bootstrap.tool_plan(checkout, "Linux", "x86_64")


@pytest.mark.parametrize("kind", ["regular", "symlink", "device"])
def test_archive_rejects_escape_and_special_files(tmp_path: Path, kind: str) -> None:
    archive = tmp_path / "bad.tar.gz"
    with tarfile.open(archive, "w:gz") as stream:
        member = tarfile.TarInfo("../outside" if kind == "regular" else "unsafe")
        if kind == "symlink":
            member.type, member.linkname = tarfile.SYMTYPE, "../outside"
        elif kind == "device":
            member.type = tarfile.CHRTYPE
        stream.addfile(member)
    with pytest.raises(bootstrap.BootstrapError, match="Unsafe"):
        bootstrap.unpack(archive, tmp_path / "unpacked")
    assert not (tmp_path / "outside").exists()


@pytest.mark.parametrize("archive_kind", ["tar", "wheel"])
def test_verified_tool_install_and_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, archive_kind: str
) -> None:
    payload = io.BytesIO()
    if archive_kind == "tar":
        with tarfile.open(fileobj=payload, mode="w:gz") as stream:
            item = tarfile.TarInfo("sdk/bin/node")
            item.mode, item.size = 0o755, 3
            stream.addfile(item, io.BytesIO(b"sdk"))
        tool = bootstrap.Tool(
            "node", "node.tar.gz", "binary", "checksum", "sdk", "bin/node"
        )
    else:
        with zipfile.ZipFile(payload, "w") as wheel:
            wheel.writestr("uv.data/scripts/uv", b"sdk")
        tool = bootstrap.Tool("uv", "uv.whl", "metadata", "metadata", "uv", "uv")
    data = payload.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    downloads: list[str] = []

    def fetch(url: str, target: Path) -> None:
        downloads.append(url)
        if url == "checksum":
            target.write_text(digest + "  node.tar.gz\n")
        elif url == "metadata":
            target.write_text(
                json.dumps(
                    {
                        "urls": [
                            {
                                "filename": "uv.whl",
                                "url": "https://files.pythonhosted.org/uv.whl",
                                "digests": {"sha256": digest},
                            }
                        ]
                    }
                )
            )
        else:
            target.write_bytes(data)

    monkeypatch.setattr(bootstrap, "download", fetch)
    home = bootstrap.install_tool(tool, tmp_path)
    assert (home / tool.executable).read_bytes() == b"sdk"
    assert (home / tool.executable).stat().st_mode & 0o111
    assert bootstrap.install_tool(tool, tmp_path) == home
    assert len(downloads) == 2


def test_bad_checksum_is_not_installed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fetch(url: str, target: Path) -> None:
        target.write_bytes(b"0" * 64 if url == "checksum" else b"corrupt archive")

    monkeypatch.setattr(bootstrap, "download", fetch)
    with pytest.raises(bootstrap.BootstrapError, match="SHA-256 mismatch"):
        bootstrap.install_tool(
            bootstrap.Tool(
                "node", "node.tar.gz", "binary", "checksum", "sdk", "bin/node"
            ),
            tmp_path,
        )
    assert not (tmp_path / "node").exists()
    with pytest.raises(bootstrap.BootstrapError, match="checksum missing"):
        bootstrap.checksum("invalid", "node.tar.gz")


def test_download_uses_https_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def response(url: str, timeout: int) -> io.BytesIO:
        assert url == "https://publisher.example/sdk"
        assert timeout == 60
        return io.BytesIO(b"download")

    monkeypatch.setattr(urllib.request, "urlopen", response)
    target = tmp_path / "archive"
    bootstrap.download("https://publisher.example/sdk", target)
    assert target.read_bytes() == b"download"
