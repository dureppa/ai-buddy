"""Prepare project-local tools using only the host Python standard library."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

UV_VERSION = "0.9.11"


class BootstrapError(Exception):
    pass


@dataclass(frozen=True)
class Tool:
    name: str
    archive: str
    url: str
    checksum_url: str
    prefix: str
    executable: str


def positive(value: str, name: str, maximum: int) -> int:
    if not re.fullmatch(r"[0-9]{1,6}", value) or not 1 <= int(value) <= maximum:
        raise BootstrapError(f"{name} must be an integer in [1, {maximum}]")
    return int(value)


def tool_plan(root: Path, system: str, machine: str) -> list[Tool]:
    if system not in {"Linux", "Darwin"} or machine not in {
        "x86_64",
        "aarch64",
        "arm64",
    }:
        raise BootstrapError(
            "Supported hosts: Linux/macOS x64 or arm64; use WSL on Windows."
        )
    node_version = (root / ".nvmrc").read_text().strip()
    match = re.search(
        r"^go ([0-9.]+)$", (root / "web/backend/go.mod").read_text(), re.MULTILINE
    )
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", node_version) or match is None:
        raise BootstrapError(
            "Expected pinned Node and Go versions in .nvmrc and go.mod"
        )
    node_os, go_os = ("linux", "linux") if system == "Linux" else ("darwin", "darwin")
    node_arch, go_arch, uv_arch = (
        ("x64", "amd64", "x86_64")
        if machine == "x86_64"
        else ("arm64", "arm64", "aarch64")
    )
    node_prefix = f"node-v{node_version}-{node_os}-{node_arch}"
    go_archive = f"go{match[1]}.{go_os}-{go_arch}.tar.gz"
    uv_tag = (
        f"manylinux_2_17_{uv_arch}.manylinux2014_{uv_arch}"
        + (".musllinux_1_1_aarch64" if uv_arch == "aarch64" else "")
        if system == "Linux"
        else "macosx_10_12_x86_64"
        if uv_arch == "x86_64"
        else "macosx_11_0_arm64"
    )
    uv_metadata = f"https://pypi.org/pypi/uv/{UV_VERSION}/json"
    return [
        Tool(
            "node",
            node_prefix + ".tar.gz",
            f"https://nodejs.org/dist/v{node_version}/{node_prefix}.tar.gz",
            f"https://nodejs.org/dist/v{node_version}/SHASUMS256.txt",
            node_prefix,
            "bin/node",
        ),
        Tool(
            "go",
            go_archive,
            f"https://dl.google.com/go/{go_archive}",
            f"https://dl.google.com/go/{go_archive}.sha256",
            "go",
            "bin/go",
        ),
        Tool(
            "uv",
            f"uv-{UV_VERSION}-py3-none-{uv_tag}.whl",
            uv_metadata,
            uv_metadata,
            "uv",
            "uv",
        ),
    ]


def checksum(text: str, filename: str) -> str:
    for line in text.splitlines():
        parts = line.strip().split()
        if (
            parts
            and re.fullmatch(r"[a-fA-F0-9]{64}", parts[0])
            and (
                len(parts) == 1
                or (len(parts) == 2 and parts[1].lstrip("*") == filename)
            )
        ):
            return parts[0].lower()
    raise BootstrapError(f"Publisher checksum missing for {filename}")


def download(url: str, target: Path) -> None:
    with (
        urllib.request.urlopen(url, timeout=60) as response,
        target.open("wb") as stream,
    ):
        shutil.copyfileobj(response, stream)


def unpack(archive: Path, destination: Path) -> None:
    """Reject paths, links and special files that could escape the temporary directory."""
    base = destination.resolve()
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            target = (base / member.name).resolve()
            if not target.is_relative_to(base) or not (
                member.isfile() or member.isdir() or member.issym() or member.islnk()
            ):
                raise BootstrapError("Unsafe tool archive")
            if member.issym() or member.islnk():
                link = (target.parent if member.issym() else base) / member.linkname
                if not link.resolve().is_relative_to(base):
                    raise BootstrapError("Unsafe tool archive link")
            if hasattr(tarfile, "data_filter"):
                source.extract(member, base, filter="data")
            else:
                source.extract(member, base)


def install_tool(tool: Tool, cache: Path) -> Path:
    # Include the full archive name: Go always uses a 'go/' archive directory.
    destination = cache / tool.archive.removesuffix(".tar.gz").removesuffix(".whl")
    if (destination / tool.executable).is_file():
        return destination
    print(f"Preparing {tool.name}: {tool.archive}", flush=True)
    with tempfile.TemporaryDirectory(prefix="install-", dir=cache) as temporary:
        stage = Path(temporary)
        archive, sums = stage / tool.archive, stage / "checksums"
        download(tool.checksum_url, sums)
        if tool.name == "uv":
            matches = [
                file
                for file in json.loads(sums.read_text())["urls"]
                if file["filename"] == tool.archive
            ]
            if len(matches) != 1 or not matches[0]["url"].startswith(
                "https://files.pythonhosted.org/"
            ):
                raise BootstrapError("Missing official uv wheel for this platform")
            expected = checksum(matches[0]["digests"]["sha256"], tool.archive)
            download(matches[0]["url"], archive)
        else:
            expected = checksum(sums.read_text(), tool.archive)
            download(tool.url, archive)
        with archive.open("rb") as stream:
            digest = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise BootstrapError(
                f"SHA-256 mismatch for {tool.archive}; installation aborted"
            )
        extracted = stage / "files" / tool.prefix
        if tool.name == "uv":
            with zipfile.ZipFile(archive) as wheel:
                members = [name for name in wheel.namelist() if Path(name).name == "uv"]
                if len(members) != 1:
                    raise BootstrapError("Missing uv executable in wheel")
                extracted.mkdir(parents=True)
                binary = extracted / "uv"
                binary.write_bytes(wheel.read(members[0]))
                binary.chmod(0o755)
        else:
            unpack(archive, stage / "files")
        if not (extracted / tool.executable).is_file():
            raise BootstrapError(f"Missing executable in {tool.archive}")
        if destination.exists():
            shutil.rmtree(destination)
        extracted.rename(destination)
    return destination


def run(command: Sequence[str], root: Path, environment: dict[str, str]) -> None:
    subprocess.run(command, cwd=root, env=environment, check=True)


def fingerprint(root: Path, paths: Sequence[str], label: str) -> str:
    digest = hashlib.sha256(label.encode())
    for relative in paths:
        digest.update(relative.encode() + b"\0" + (root / relative).read_bytes())
    return digest.hexdigest()


def prepare(root: Path, cache: Path) -> dict[str, str]:
    system, machine = platform.system(), platform.machine()
    if system == "Linux" and platform.libc_ver()[0] == "musl":
        raise BootstrapError("This launcher requires Linux with glibc or macOS")
    node, go, uv = [
        install_tool(tool, cache) for tool in tool_plan(root, system, machine)
    ]
    environment = dict(os.environ)
    for key in (
        "DEEPSEEK_API_KEY",
        "OPENAI_API_KEY",
        "LANGSMITH_API_KEY",
        "LANGCHAIN_API_KEY",
        "AI_SERVICE_URL",
        "AI_SERVICE_TOKEN",
        "VIRTUAL_ENV",
        "UV_OFFLINE",
        "UV_PYTHON_DOWNLOADS",
        "UV_ENV_FILE",
    ):
        environment.pop(key, None)
    environment.update(
        {
            "PATH": os.pathsep.join(
                (
                    str(node / "bin"),
                    str(go / "bin"),
                    str(uv),
                    environment.get("PATH", ""),
                )
            ),
            "GOPATH": str(cache / "go-path"),
            "GOROOT": str(go),
            "CGO_ENABLED": "0",
            "GOMODCACHE": str(cache / "go-mod"),
            "GOCACHE": str(cache / "go-build"),
            "GOTOOLCHAIN": "local",
            "GOWORK": "off",
            "GOENV": "off",
            "GOFLAGS": "",
            "GOPROXY": "https://proxy.golang.org,direct",
            "GOSUMDB": "sum.golang.org",
            "npm_config_cache": str(cache / "npm-cache"),
            "UV_CACHE_DIR": str(cache / "uv-cache"),
            "UV_PYTHON_INSTALL_DIR": str(cache / "python"),
            "UV_PYTHON_BIN_DIR": str(cache / "python-bin"),
            "UV_PYTHON_PREFERENCE": "only-managed",
            "UV_PROJECT_ENVIRONMENT": str(root / "ai-agent/.venv"),
            "LANGSMITH_TRACING": "false",
            "LANGCHAIN_TRACING_V2": "false",
            "TMPDIR": str(cache / "tmp"),
        }
    )
    (cache / "tmp").mkdir(exist_ok=True)
    package = json.loads((root / "package.json").read_text())
    npm_version = str(package["packageManager"]).removeprefix("npm@")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", npm_version):
        raise BootstrapError("Expected pinned npm packageManager version")
    bundled = json.loads((node / "lib/node_modules/npm/package.json").read_text())[
        "version"
    ]
    if bundled != npm_version:
        npm_home = cache / f"npm-{npm_version}"
        if not (npm_home / "node_modules/npm/bin/npm-cli.js").is_file():
            run(
                [
                    str(node / "bin/npm"),
                    "install",
                    "--prefix",
                    str(npm_home),
                    "--no-save",
                    "--package-lock=false",
                    "--no-audit",
                    "--no-fund",
                    f"npm@{npm_version}",
                ],
                root,
                environment,
            )
        environment["PATH"] = (
            str(npm_home / "node_modules/.bin") + os.pathsep + environment["PATH"]
        )
    paths = ["package.json", "package-lock.json", ".nvmrc"] + [
        str(workspace) + "/package.json" for workspace in package["workspaces"]
    ]
    digest = fingerprint(root, paths, system + machine)
    marker = cache / "frontend.sha256"
    if (
        not (root / "node_modules/.bin/vitest").exists()
        or not marker.exists()
        or marker.read_text() != digest
    ):
        print("Preparing frontend dependencies...", flush=True)
        run(["npm", "ci", "--no-audit", "--no-fund"], root, environment)
        marker.write_text(digest)
    print("Checking Python dependencies...", flush=True)
    run(["uv", "sync", "--locked"], root / "ai-agent", environment)
    digest = fingerprint(
        root, ["web/backend/go.mod", "web/backend/go.sum"], system + machine
    )
    marker = cache / "go.sha256"
    if (
        not (cache / "go-mod").is_dir()
        or not marker.exists()
        or marker.read_text() != digest
    ):
        print("Preparing Go dependencies...", flush=True)
        run(["go", "mod", "download"], root / "web/backend", environment)
        marker.write_text(digest)
    environment.update({"UV_OFFLINE": "1", "GOPROXY": "off", "GOSUMDB": "off"})
    return environment


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="load_test.sh",
        description="Run frontend, Go and Python load tests locally. No Docker or just required.",
    )
    parser.add_argument(
        "requests", nargs="?", default=os.environ.get("LOAD_REQUESTS", "120")
    )
    parser.add_argument(
        "workers", nargs="?", default=os.environ.get("LOAD_WORKERS", "8")
    )
    options = parser.parse_args(arguments)
    try:
        values = {
            "LOAD_REQUESTS": str(positive(options.requests, "LOAD_REQUESTS", 100000)),
            "LOAD_WORKERS": str(positive(options.workers, "LOAD_WORKERS", 256)),
            "LOAD_HISTORY": str(
                positive(os.environ.get("LOAD_HISTORY", "40"), "LOAD_HISTORY", 1000)
            ),
        }
        root = Path(__file__).resolve().parent.parent
        if platform.system() not in {"Linux", "Darwin"}:
            raise BootstrapError("Use Linux/macOS or WSL to run load_test.sh")
        cache = root / ".load-tools"
        cache.mkdir(exist_ok=True)
        import fcntl

        with (cache / "launcher.lock").open("w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise BootstrapError(
                    "Another load_test.sh is running in this checkout"
                ) from error
            environment = prepare(root, cache)
            environment.update(values)
            print("Running local load tests (model calls are mocked)...", flush=True)
            run(["sh", str(root / "ops/checks/load-suite.sh")], root, environment)
    except subprocess.CalledProcessError as error:
        return error.returncode if error.returncode > 0 else 1
    except (
        BootstrapError,
        OSError,
        ValueError,
        KeyError,
        tarfile.TarError,
        zipfile.BadZipFile,
    ) as error:
        print(f"load_test: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
