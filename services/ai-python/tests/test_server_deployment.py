from pathlib import Path

import yaml


def test_server_overlay_exposes_only_browser_sites() -> None:
    root = Path(__file__).resolve().parents[3]
    # !override changes Compose list merging; strip only the tag to inspect structure.
    overlay = yaml.safe_load(
        (root / "docker-compose.server.yml").read_text().replace("!override", "")
    )
    assert set(overlay["services"]) == {"web", "hr-web"}
    for service in overlay["services"].values():
        assert len(service["volumes"]) == 4
        assert all(mount.endswith(":ro") for mount in service["volumes"])
        assert any("htpasswd" in mount for mount in service["volumes"])
    compose = yaml.safe_load((root / "docker-compose.yml").read_text())
    assert "PUBLIC_HR_ORIGIN" in compose["services"]["web"]["build"]["args"]
    assert "PUBLIC_WEB_ORIGIN" in compose["services"]["hr-web"]["build"]["args"]
