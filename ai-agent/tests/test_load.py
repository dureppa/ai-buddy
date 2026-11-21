"""Concurrent in-process HTTP load. No runtime environment or network clients."""

import json
import logging
import math
import os
import socket
import threading
import time
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

import httpx
import pytest
from pydantic import SecretStr

from ai_buddy import create_app
from ai_buddy.mcp_client import Session
from ai_buddy.schemas import TurnRequest
from tests.helpers import FakeSession, result, settings
from tests.test_deepseek import response


def load_size(name: str, fallback: int, maximum: int) -> int:
    value = int(os.environ.get(name, str(fallback)))
    if not 1 <= value <= maximum:
        raise ValueError(f"{name} must be an integer in [1, {maximum}]")
    return value


@pytest.mark.parametrize("value", ["0", "-1", "257", "bad"])
def test_load_size_rejects_invalid_input(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    monkeypatch.setenv("LOAD_WORKERS", value)
    with pytest.raises(ValueError):
        load_size("LOAD_WORKERS", 8, 256)


@pytest.mark.parametrize("value, expected", [(None, 8), ("1", 1), ("256", 256)])
def test_load_size_bounds_and_default(
    monkeypatch: pytest.MonkeyPatch, value: str | None, expected: int
) -> None:
    monkeypatch.delenv("LOAD_WORKERS", raising=False)
    if value is not None:
        monkeypatch.setenv("LOAD_WORKERS", value)
    assert load_size("LOAD_WORKERS", 8, 256) == expected


@pytest.mark.parametrize(
    "scenario, expected_status, expected_code",
    [
        ("turn", 200, None),
        ("rate_limited", 503, "AI_RATE_LIMITED"),
        ("mcp_unavailable", 503, "MCP_UNAVAILABLE"),
        ("invalid", 400, "INVALID_REQUEST"),
        ("unauthorized", 401, "UNAUTHORIZED"),
        ("health", 200, None),
    ],
)
def test_backend_load(
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
    expected_status: int,
    expected_code: str | None,
) -> None:
    requests = load_size("LOAD_REQUESTS", 120, 100000)
    workers = min(load_size("LOAD_WORKERS", 8, 256), requests)
    counters = {"network": 0, "model": 0, "tool": 0, "opened": 0, "closed": 0}
    lock = threading.Lock()

    def forbidden_network(*args: Any, **kwargs: Any) -> Any:
        with lock:
            counters["network"] += 1
        raise AssertionError("Network is forbidden in backend load tests")

    # Block real TCP, UDP and DNS, even if a dependency bypasses MockTransport.
    for name in ("connect", "connect_ex", "sendto", "sendmsg"):
        monkeypatch.setattr(socket.socket, name, forbidden_network, raising=False)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden_network)
    monkeypatch.setattr(socket, "create_connection", forbidden_network)

    def model(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.deepseek.com/chat/completions"
        assert request.headers["authorization"] == "Bearer synthetic-load-key"
        assert "delegated-load-" not in request.content.decode()
        with lock:
            counters["model"] += 1
        if scenario == "rate_limited":
            return httpx.Response(429, json={})
        return httpx.Response(
            200, json=response("Тестовый наставник @load [team-load]")
        )

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.MockTransport(model)
    )
    discovery = FakeSession().pages

    class LoadSession(FakeSession):
        def __init__(self, request_id: str) -> None:
            # Schema generation is startup work, outside the measured requests.
            self.pages = discovery
            self.calls = []
            self.failure = None
            self.request_id = request_id

        async def call_tool(
            self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
        ) -> Any:
            assert name == "get_team_context"
            assert meta == {"ai-buddy.example/request-id": self.request_id}
            with lock:
                counters["tool"] += 1
            return await super().call_tool(name, arguments, meta=meta)

    @asynccontextmanager
    async def sessions(context: TurnRequest) -> AsyncIterator[Session]:
        session = LoadSession(str(context.request_id))
        session.response = result(
            {
                "ok": True,
                "data": {
                    "team": None,
                    "mentor": {
                        "display_name": "Тестовый наставник",
                        "contact": "@load",
                    },
                    "lead": None,
                    "references": [
                        {
                            "id": "team-load",
                            "title": "Учебная команда",
                            "url": "/team",
                            "version": "1",
                            "is_demo": True,
                        }
                    ],
                },
            }
        )
        if scenario == "mcp_unavailable":
            session.failure = RuntimeError("synthetic MCP failure")
        with lock:
            counters["opened"] += 1
        try:
            yield session
        finally:
            with lock:
                counters["closed"] += 1

    # Explicit Settings ignore any real API key, .env and provider configuration.
    app = create_app(
        settings(
            agent_enabled=True,
            llm_provider="deepseek",
            deepseek_api_key=SecretStr("synthetic-load-key"),
        ),
        session_factory=sessions,
    )
    # Production logs are covered elsewhere; they would dominate short requests.
    monkeypatch.setattr(app.logger, "level", logging.ERROR)
    start = threading.Barrier(workers + 1)
    latencies = [0.0] * requests
    failures: list[str] = []

    def worker(worker_id: int) -> None:
        # Flask clients and MCP sessions are never shared between workers.
        with app.test_client() as client:
            start.wait(timeout=30)
            for index in range(worker_id, requests, workers):
                identifier = str(UUID(int=index + 1))
                data = {
                    "request_id": identifier,
                    "conversation_id": str(UUID(int=requests + index + 1)),
                    "message": "Кто мой наставник?",
                    "delegation_token": f"delegated-load-{index}",
                }
                if scenario == "invalid":
                    data["message"] = " "
                headers = {"Authorization": "Bearer service-secret"}
                if scenario == "unauthorized":
                    headers = {}
                began = time.perf_counter()
                reply = (
                    client.get("/health/live")
                    if scenario == "health"
                    else client.post("/internal/v1/turns", json=data, headers=headers)
                )
                latencies[index] = time.perf_counter() - began
                body = reply.get_json()
                try:
                    assert reply.status_code == expected_status
                    if expected_code:
                        assert body["error"]["code"] == expected_code
                    elif scenario == "health":
                        assert body == {"status": "alive"}
                    else:
                        assert body["request_id"] == identifier
                        assert body["conversation_id"] == data["conversation_id"]
                        assert "Тестовый наставник" in body["reply"]["text"]
                        assert body["reply"]["references"] == [
                            {"title": "Учебная команда", "url": "/team"}
                        ]
                    assert "delegated-load-" not in reply.text
                    assert "synthetic-load-key" not in reply.text
                except (AssertionError, KeyError, TypeError):
                    with lock:
                        failures.append(f"request {index}: {reply.status_code} {body}")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(worker, worker_id) for worker_id in range(workers)]
        began = time.perf_counter()
        start.wait(timeout=30)
        for future in futures:
            future.result(timeout=300)
    elapsed = time.perf_counter() - began
    ordered = sorted(latencies)
    print(
        "LOAD_RESULT "
        + json.dumps(
            {
                "scenario": scenario,
                "requests": requests,
                "workers": workers,
                "errors": len(failures),
                "rps": round(requests / elapsed, 2),
                "p50_ms": round(ordered[math.ceil(requests * 0.50) - 1] * 1000, 3),
                "p95_ms": round(ordered[math.ceil(requests * 0.95) - 1] * 1000, 3),
                "p99_ms": round(ordered[math.ceil(requests * 0.99) - 1] * 1000, 3),
                "max_ms": round(ordered[-1] * 1000, 3),
                **counters,
            }
        )
    )
    active = scenario in {"turn", "rate_limited", "mcp_unavailable"}
    assert counters["network"] == 0
    assert counters["opened"] == counters["closed"] == (requests if active else 0)
    assert counters["tool"] == (requests if active else 0)
    assert counters["model"] == (
        requests if scenario in {"turn", "rate_limited"} else 0
    )
    assert all(latency > 0 for latency in latencies)
    assert not failures, "\n".join(failures[:3])
