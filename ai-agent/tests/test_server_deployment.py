from pathlib import Path

import yaml


def test_server_overlay_exposes_only_browser_sites() -> None:
    root = Path(__file__).resolve().parents[2]
    # !override changes Compose list merging; strip only the tag to inspect structure.
    overlay = yaml.safe_load(
        (root / "docker-compose.server.yml").read_text().replace("!override", "")
    )
    published = {
        name for name, service in overlay["services"].items() if service.get("ports")
    }
    assert published == {"web", "hr-web"}
    assert overlay["services"]["confluence"]["ports"] == []
    assert all(
        service["restart"] == "unless-stopped"
        for name, service in overlay["services"].items()
        if name != "jira-migrate"
    )
    assert "restart" not in overlay["services"]["jira-migrate"]
    for name in ("jira", "jira-db", "jira-migrate"):
        assert overlay["services"][name]["profiles"] == []
    for name in published:
        service = overlay["services"][name]
        assert len(service["volumes"]) == 4
        assert all(mount.endswith(":ro") for mount in service["volumes"])
        assert any("htpasswd" in mount for mount in service["volumes"])
    compose = yaml.safe_load((root / "docker-compose.yml").read_text())
    assert "PUBLIC_HR_ORIGIN" in compose["services"]["web"]["build"]["args"]
    assert "PUBLIC_WEB_ORIGIN" in compose["services"]["hr-web"]["build"]["args"]


def test_server_credentials_and_backups_are_excluded_from_build_context() -> None:
    root = Path(__file__).resolve().parents[2]
    patterns = (root / ".dockerignore").read_text().splitlines()
    assert {".deploy", "backups", "source.tar"} <= set(patterns)
