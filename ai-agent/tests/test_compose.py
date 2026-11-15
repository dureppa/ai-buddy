from pathlib import Path

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
