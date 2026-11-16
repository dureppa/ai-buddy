import os
import subprocess
from pathlib import Path

import pytest
import yaml


def test_compose_has_no_local_model_download_or_image() -> None:
    root = Path(__file__).resolve().parents[2]
    text = (root / "docker-compose.yml").read_text()
    config = yaml.safe_load(text)
    services = config["services"]
    assert "ollama" not in text.lower()
    assert "model" not in services
    assert set(config["volumes"]) == {"postgres", "jira-postgres"}
    assert services["agent"]["environment"]["AI_LLM_PROVIDER"] == "deepseek"
    assert services["go"]["environment"]["AI_SERVICE_URL"] == "http://agent:8001"
    assert services["mcp"]["network_mode"] == "service:agent"
    assert "depends_on" not in services["agent"]
    assert services["mcp"]["depends_on"]["agent"]["condition"] == "service_started"
    for service in ("agent", "mcp"):
        assert "ports" not in services[service]
    smoke = (root / "ops/docker/check-agent.sh").read_text()
    assert "11434" not in smoke and "OLLAMA" not in smoke
    assert "/api/v1/chat/messages" in smoke


def test_jira_owns_database_and_waits_for_migration() -> None:
    root = Path(__file__).resolve().parents[2]
    services = yaml.safe_load((root / "docker-compose.yml").read_text())["services"]
    database = services["jira-db"]
    assert database["environment"]["POSTGRES_DB"] == "jira"
    assert database["volumes"] == ["jira-postgres:/var/lib/postgresql/data"]
    assert "ports" not in database
    assert services["jira"]["environment"]["PGHOST"] == "jira-db"
    assert services["jira"]["depends_on"]["jira-migrate"]["condition"] == (
        "service_completed_successfully"
    )
    for name in ("jira-db", "jira-migrate", "jira"):
        assert services[name]["profiles"] == ["jira"]


@pytest.mark.parametrize("failure", ["", "info", "build"])
@pytest.mark.parametrize("parallel", [False, True])
def test_local_start_stops_on_failure_and_never_rebuilds_during_up(
    tmp_path: Path, failure: str, parallel: bool
) -> None:
    root = Path(__file__).resolve().parents[2]
    docker = tmp_path / "docker"
    calls = tmp_path / "calls"
    docker.write_text("""#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS"
case "$*" in
  info) [ "$FAILURE" != info ] || exit 17 ;;
  *'config --services') printf 'agent\\nweb\\n' ;;
  *'build'|*'build web') [ "$FAILURE" != build ] || exit 17 ;;
esac
exit 0
""")
    docker.chmod(0o755)
    result = subprocess.run(
        [
            "sh",
            str(root / "ops/docker/start-local.sh"),
            *(["--parallel"] if parallel else []),
        ],
        cwd=tmp_path,
        env={
            **os.environ,
            "PATH": str(tmp_path) + os.pathsep + os.environ["PATH"],
            "DOCKER_CALLS": str(calls),
            "FAILURE": failure,
        },
        check=False,
        capture_output=True,
        text=True,
    )
    commands = calls.read_text().splitlines()
    assert result.returncode == (17 if failure else 0)
    starts = [command for command in commands if " up " in command]
    assert starts == (
        []
        if failure
        else [
            "compose --profile hr --profile jira up -d --no-build --wait --wait-timeout 900"
        ]
    )
    if failure != "info":
        builds = [command for command in commands if " build" in command]
        assert builds == (
            ["compose --profile hr --profile jira build"]
            if parallel
            else [
                "compose --profile hr --profile jira build agent",
                "compose --profile hr --profile jira build web",
            ]
        )
