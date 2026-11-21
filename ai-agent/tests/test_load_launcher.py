"""Run the real shell launchers with isolated fake commands, without Docker."""

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def checkout(tmp_path: Path) -> Path:
    root = tmp_path / "fresh checkout with spaces"
    for relative in ("load-test.sh", "ops/checks/load-suite.sh"):
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text((ROOT / relative).read_text())
    return root


@pytest.fixture
def command_bin(tmp_path: Path) -> Path:
    binary = tmp_path / "bin"
    binary.mkdir()
    dirname = shutil.which("dirname")
    assert dirname
    (binary / "dirname").symlink_to(dirname)
    script = (
        f"#!{sys.executable}\n"
        + """
import json
import os
import sys
from pathlib import Path

name = Path(sys.argv[0]).name
args = sys.argv[1:]
record = {"name": name, "args": args, "cwd": os.getcwd(),
          "load": {key: os.environ.get(key) for key in
                   ("LOAD_REQUESTS", "LOAD_WORKERS", "LOAD_HISTORY")}}
with open(os.environ["CALL_LOG"], "a") as stream:
    stream.write(json.dumps(record) + "\\n")
stage = args[0] if name == "docker" else name
if stage == os.environ.get("FAIL_STAGE"):
    sys.exit(19)
"""
    )
    for name in ("docker", "npm", "go", "uv"):
        command = binary / name
        command.write_text(script)
        command.chmod(0o755)
    return binary


def run_launcher(
    root: Path, binary: Path, args: list[str], **updates: str
) -> tuple[subprocess.CompletedProcess[str], list[dict[str, Any]]]:
    log = root / "calls.jsonl"
    result = subprocess.run(
        ["/bin/sh", str(root / "load-test.sh"), *args],
        cwd=root.parent,
        env={
            "PATH": str(binary),
            "CALL_LOG": str(log),
            # A caller's key must never be forwarded into docker arguments.
            "DEEPSEEK_API_KEY": "do-not-forward-this-key",
            **updates,
        },
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )
    calls = (
        [json.loads(line) for line in log.read_text().splitlines()]
        if log.exists()
        else []
    )
    return result, calls


@pytest.mark.parametrize("args", [[], ["1", "256"], ["100000", "1"]])
def test_launcher_works_outside_checkout_and_passes_only_load_parameters(
    checkout: Path, command_bin: Path, args: list[str]
) -> None:
    result, calls = run_launcher(checkout, command_bin, args)
    assert result.returncode == 0, result.stderr
    assert [call["args"][0] for call in calls] == ["info", "build", "run"]
    assert calls[1]["args"] == [
        "build",
        "--file",
        str(checkout / "ops/docker/Dockerfile.load"),
        "--tag",
        "ai-buddy-load-tests:local",
        str(checkout),
    ]
    assert calls[2]["args"] == [
        "run",
        "--rm",
        "--network=none",
        "--env",
        "LOAD_REQUESTS=" + (args[0] if args else "120"),
        "--env",
        "LOAD_WORKERS=" + (args[1] if args else "8"),
        "--env",
        "LOAD_HISTORY=40",
        "ai-buddy-load-tests:local",
    ]
    assert "do-not-forward" not in json.dumps(calls)
    assert "--env-file" not in json.dumps(calls)


def test_launcher_accepts_environment_defaults_and_explicit_arguments_win(
    checkout: Path, command_bin: Path
) -> None:
    result, calls = run_launcher(
        checkout,
        command_bin,
        ["4"],
        LOAD_REQUESTS="9",
        LOAD_WORKERS="3",
        LOAD_HISTORY="1",
    )
    assert result.returncode == 0, result.stderr
    assert "LOAD_REQUESTS=4" in calls[-1]["args"]
    assert "LOAD_WORKERS=3" in calls[-1]["args"]
    assert "LOAD_HISTORY=1" in calls[-1]["args"]


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
        ([], {"LOAD_HISTORY": "bad"}),
        ([], {"LOAD_REQUESTS": "bad"}),
    ],
)
def test_invalid_parameters_fail_before_build_or_network(
    checkout: Path, command_bin: Path, args: list[str], update: dict[str, str]
) -> None:
    result, calls = run_launcher(checkout, command_bin, args, **update)
    assert result.returncode == 2
    assert "load-test:" in result.stderr
    assert not calls


def test_help_and_missing_docker_are_actionable(
    checkout: Path, command_bin: Path
) -> None:
    (command_bin / "docker").unlink()
    result, calls = run_launcher(checkout, command_bin, ["--help"])
    assert result.returncode == 0 and "Usage:" in result.stdout
    assert not calls
    result, calls = run_launcher(checkout, command_bin, [])
    assert result.returncode == 2 and "Docker is not installed" in result.stderr
    assert not calls


@pytest.mark.parametrize(
    "stage, expected",
    [
        ("info", ["info"]),
        ("build", ["info", "build"]),
        ("run", ["info", "build", "run"]),
    ],
)
def test_docker_failure_stops_and_propagates(
    checkout: Path, command_bin: Path, stage: str, expected: list[str]
) -> None:
    result, calls = run_launcher(checkout, command_bin, [], FAIL_STAGE=stage)
    assert result.returncode == (2 if stage == "info" else 19)
    assert [call["args"][0] for call in calls] == expected
    if stage == "info":
        assert "Start Docker" in result.stderr


@pytest.mark.parametrize("failure", ["", "npm", "go", "uv"])
def test_shared_suite_runs_each_component_and_stops_on_failure(
    checkout: Path, command_bin: Path, failure: str
) -> None:
    for directory in ("web/backend", "ai-agent"):
        (checkout / directory).mkdir(parents=True)
    log = checkout / "suite.jsonl"
    result = subprocess.run(
        ["/bin/sh", str(checkout / "ops/checks/load-suite.sh")],
        cwd=checkout.parent,
        env={
            "PATH": str(command_bin),
            "CALL_LOG": str(log),
            "FAIL_STAGE": failure,
            "LOAD_REQUESTS": "3",
            "LOAD_WORKERS": "2",
        },
        text=True,
        capture_output=True,
        check=False,
        timeout=10,
    )
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    expected = ["npm", "go", "uv"]
    if failure:
        expected = expected[: expected.index(failure) + 1]
    assert result.returncode == (19 if failure else 0), result.stderr
    assert [call["name"] for call in calls] == expected
    directories = {
        "npm": checkout,
        "go": checkout / "web/backend",
        "uv": checkout / "ai-agent",
    }
    for call in calls:
        assert call["cwd"] == str(directories[call["name"]])
        assert call["load"]["LOAD_REQUESTS"] == "3"
        assert call["load"]["LOAD_WORKERS"] == "2"
