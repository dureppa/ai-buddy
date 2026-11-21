"""Exercise the external-sites nginx config, including the deployment gate."""

import base64
import gzip
import hashlib
import os
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import pytest


@pytest.mark.skipif(
    os.environ.get("TEST_NGINX") != "1",
    reason="set TEST_NGINX=1 for Docker integration",
)
def test_static_assets(tmp_path: Path) -> None:
    config = (
        Path(__file__).resolve().parents[2] / "ops/docker/hr-web.conf"
    ).read_text()
    password = base64.b64encode(hashlib.sha1(b"test-password").digest()).decode()
    (tmp_path / "htpasswd").write_text(f"tester:{{SHA}}{password}\n")
    (tmp_path / "htpasswd").chmod(0o644)
    config = config.replace(
        "server {",
        'server {\n    auth_basic "Test gate";\n'
        "    auth_basic_user_file /etc/nginx/test-htpasswd;\n"
        '    add_header Set-Cookie "test-gate=valid; Path=/; HttpOnly";',
        1,
    )
    (tmp_path / "default.conf").write_text(config)
    assets = tmp_path / "html/jira/assets"
    assets.mkdir(parents=True)
    source = b"const message = 'static asset payload';\n" * 2000
    for name in ["index-abcDEF12.js", "index-abcDEF12.css", "unversioned.js"]:
        (assets / name).write_bytes(source)
    (assets.parent / "index.html").write_bytes(b"<html>Jira</html>")
    container = subprocess.check_output(
        [
            "docker",
            "run",
            "--rm",
            "-d",
            "-p",
            "127.0.0.1::5189",
            "-v",
            f"{tmp_path / 'default.conf'}:/etc/nginx/conf.d/default.conf:ro",
            "-v",
            f"{tmp_path / 'htpasswd'}:/etc/nginx/test-htpasswd:ro",
            "-v",
            f"{tmp_path / 'html'}:/usr/share/nginx/html:ro",
            "nginx:1.28-alpine",
        ],
        text=True,
    ).strip()
    try:
        subprocess.run(["docker", "exec", container, "nginx", "-t"], check=True)
        port = (
            subprocess.check_output(["docker", "port", container, "5189"], text=True)
            .strip()
            .split(":")[-1]
        )
        origin = f"http://127.0.0.1:{port}"
        for attempt in range(50):
            try:
                urlopen(origin + "/", timeout=1)
            except HTTPError as gate_response:
                assert gate_response.code == 401
                break
            except URLError:
                if attempt == 49:
                    raise
                time.sleep(0.1)
            else:
                pytest.fail("nginx must require the deployment gate")
        auth = "Basic " + base64.b64encode(b"tester:test-password").decode()
        for extension in ["js", "css"]:
            request = Request(
                origin + f"/assets/index-abcDEF12.{extension}",
                headers={"Authorization": auth, "Accept-Encoding": "gzip"},
            )
            with urlopen(request, timeout=10) as response:
                body = response.read()
                assert response.headers["Content-Encoding"] == "gzip"
                assert "Accept-Encoding" in response.headers["Vary"]
                assert "max-age=31536000" in response.headers["Cache-Control"]
                assert "test-gate=valid" in response.headers["Set-Cookie"]
                assert gzip.decompress(body) == source
                assert len(body) < len(source) // 2
        for path in ["/", "/assets/unversioned.js"]:
            with urlopen(
                Request(origin + path, headers={"Authorization": auth}), timeout=10
            ) as response:
                assert response.headers.get("Cache-Control") is None
        with pytest.raises(HTTPError) as missing:
            urlopen(
                Request(
                    origin + "/assets/missing-abcDEF12.js",
                    headers={"Authorization": auth},
                ),
                timeout=10,
            )
        assert missing.value.code == 404
        assert missing.value.headers.get("Cache-Control") is None
        for path in ["/assets/index-abcDEF12.js", "/jira-api/v1/spaces"]:
            with pytest.raises(HTTPError) as denied:
                urlopen(origin + path, timeout=10)
            assert denied.value.code == 401
            assert denied.value.headers.get("Cache-Control") is None
    finally:
        subprocess.run(["docker", "rm", "-f", container], check=True)
