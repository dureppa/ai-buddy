from pathlib import Path

import yaml


def test_compose_has_no_local_model_download_or_image() -> None:
    root = Path(__file__).resolve().parents[3]
    text = (root / "docker-compose.yml").read_text()
    config = yaml.safe_load(text)
    services = config["services"]
    assert "ollama" not in text.lower()
    assert "model" not in services
    assert set(config["volumes"]) == {"postgres"}
    assert services["agent"]["environment"]["AI_LLM_PROVIDER"] == "deepseek"
    assert services["go"]["environment"]["AI_SERVICE_URL"] == "http://agent:8001"
    assert services["mcp"]["network_mode"] == "service:agent"
    assert "depends_on" not in services["agent"]
    assert services["mcp"]["depends_on"]["agent"]["condition"] == "service_started"
    for service in ("agent", "mcp"):
        assert "ports" not in services[service]
    smoke = (root / "docker/check-agent.sh").read_text()
    assert "11434" not in smoke and "OLLAMA" not in smoke
    assert "/api/v1/chat/messages" in smoke
