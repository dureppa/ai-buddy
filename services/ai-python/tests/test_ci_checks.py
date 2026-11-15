"""Execute workflow/just commands without rg; failures must never become skips."""

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]


def command(source: str, job: str) -> str:
    if source == "workflow":
        workflow: Any = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
        if job == "repository":
            return str(
                next(
                    s["run"]
                    for s in workflow["jobs"][job]["steps"]
                    if "ls-files" in s.get("run", "")
                )
            )
        return str(
            next(
                s["run"]
                for s in workflow["jobs"][job]["steps"]
                if s.get("working-directory")
                == f"services/{'ai-python' if job == 'python' else 'backend-go'}"
            )
        )
    recipe = (
        (ROOT / "justfile")
        .read_text()
        .split(job + "-check:\n", 1)[1]
        .split("\n\n", 1)[0]
    )
    script = "\n".join(line.removeprefix("\t") for line in recipe.splitlines())
    return (
        next(line for line in script.splitlines() if "ls-files" in line)
        if job == "repository"
        else script
    )


@pytest.mark.parametrize("source", ["workflow", "just"])
@pytest.mark.parametrize(
    ("job", "failure"),
    [
        ("python", f)
        for f in (
            "",
            "uv sync",
            "uv run --locked ruff format",
            "uv run --locked ruff check",
            "uv run --locked mypy",
            "uv run --locked pytest",
        )
    ]
    + [
        ("go", f)
        for f in (
            "",
            "gofmt",
            "go vet",
            "go test ./...",
            "go test -race",
            "go test -coverprofile",
            "go tool cover",
        )
    ],
)
def test_checks_execute_and_propagate_failure(
    tmp_path: Path, source: str, job: str, failure: str
) -> None:
    tools = tmp_path / "bin"
    tools.mkdir()
    log = tmp_path / "calls"
    for name in ("uv", "gofmt", "go"):
        tool = tools / name
        tool.write_text("""#!/bin/sh
call="${0##*/} $*"
printf '%s\\n' "$call" >> "$CALL_LOG"
if [ -n "$FAIL_ON" ]; then
  case "$call" in "$FAIL_ON"*) exit 19;; esac
fi
""")
        tool.chmod(0o755)
    for directory in ("services/ai-python", "services/backend-go"):
        (tmp_path / directory).mkdir(parents=True)
    cwd = (
        tmp_path
        if source == "just"
        else tmp_path / "services" / ("ai-python" if job == "python" else "backend-go")
    )
    script = command(source, job)
    result = subprocess.run(
        ["/bin/bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script],
        cwd=cwd,
        env={
            **os.environ,
            "PATH": str(tools),
            "CALL_LOG": str(log),
            "FAIL_ON": failure,
        },
        capture_output=True,
        check=False,
        text=True,
        timeout=10,
    )
    calls = log.read_text().splitlines() if log.exists() else []
    assert calls, result.stderr
    assert "rg" not in script
    expected = (
        [
            "uv sync --locked",
            "uv run --locked ruff format --check . ../../scripts/deploy",
            "uv run --locked ruff check . ../../scripts/deploy",
            "uv run --locked mypy . ../../scripts/deploy",
            "uv run --locked pytest --cov=. --cov=../../scripts/deploy --cov-report=term-missing --cov-fail-under=80",
        ]
        if job == "python"
        else [
            "gofmt -l .",
            "go vet ./...",
            "go test ./...",
            "go test -race ./...",
            "go test -coverprofile=coverage.out -covermode=atomic ./...",
            "go tool cover -func=coverage.out",
        ]
    )
    if failure:
        last = next(i for i, c in enumerate(expected) if c.startswith(failure))
        assert result.returncode != 0
        assert calls == expected[: last + 1]
    else:
        assert result.returncode == 0, result.stderr
        assert calls == expected


@pytest.mark.parametrize("source", ["workflow", "just"])
@pytest.mark.parametrize(
    ("path", "git_failure"),
    [
        ("src/normal.py", False),
        ("app/dist/generated.js", False),
        ("service/.venv/bin/python", False),
        ("src/normal.py", True),
    ],
)
def test_artifact_check_without_ripgrep(
    tmp_path: Path, source: str, path: str, git_failure: bool
) -> None:
    git = shutil.which("git")
    assert git
    subprocess.run([git, "init", "-q", str(tmp_path)], check=True)
    item = tmp_path / path
    item.parent.mkdir(parents=True)
    item.write_text("fixture")
    subprocess.run([git, "-C", str(tmp_path), "add", "--", path], check=True)
    tools = tmp_path / "bin"
    tools.mkdir()
    (tools / "python3").symlink_to(sys.executable)
    (tools / "git").symlink_to(git)
    script = command(source, "repository")
    result = subprocess.run(
        ["/bin/bash", "-eo", "pipefail", "-c", script],
        cwd=tmp_path,
        env={
            **os.environ,
            "PATH": str(tools),
            **({"GIT_DIR": str(tmp_path / "missing")} if git_failure else {}),
        },
        capture_output=True,
        check=False,
        timeout=10,
    )
    assert (result.returncode == 0) == (path == "src/normal.py" and not git_failure), (
        result.stderr
    )
