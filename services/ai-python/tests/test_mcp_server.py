"""SDK protocol tests for the actual local server factory, without LLM or Go."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from ai_buddy.config import Settings
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import Gateway
from ai_buddy.mcp_server import DemoBackend, create_demo_app, create_mcp_app
from tests.helpers import context


@asynccontextmanager
async def connected(app: Any, token: str = "test-secret") -> AsyncIterator[Gateway]:
    async with (
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            headers={"Authorization": "Bearer " + token},
        ) as client,
        streamable_http_client("http://127.0.0.1/mcp", http_client=client) as (
            read,
            write,
            _,
        ),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        gateway = Gateway(session, context(), Settings(tool_timeout=1))
        await gateway.discover()
        yield gateway


def test_real_catalog_search_empty_team_and_profile_isolation() -> None:
    async def run() -> None:
        app = create_mcp_app(
            DemoBackend(), principals={"test-secret": "alex", "second-secret": "nina"}
        )
        async with app.router.lifespan_context(app):
            async with connected(app) as gateway:
                assert gateway.available == frozenset(
                    {"search_knowledge", "get_team_context"}
                )
                data = await gateway.call(
                    "search_knowledge", {"query": "  оформить  отсутствие ", "limit": 1}
                )
                assert len(data["documents"]) == 1
                assert data["documents"][0]["source"]["id"] == "demo-absences"
                assert data["documents"][0]["source"]["is_demo"] is True
                assert (
                    await gateway.call(
                        "search_knowledge", {"query": "Марсианская премия"}
                    )
                )["documents"] == []

            async def team(token: str) -> str:
                async with connected(app, token) as gateway:
                    return str(
                        (await gateway.call("get_team_context", {}))["team"]["id"]
                    )

            first, second = await asyncio.gather(
                team("test-secret"), team("second-secret")
            )
            assert (first, second) == (
                "demo-alex",
                "demo-nina",
            )

    asyncio.run(run())


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({}, 401),
        ({"Authorization": "Bearer wrong"}, 401),
        ({"Authorization": "Bearer test-secret", "Host": "evil.example"}, 421),
        (
            {"Authorization": "Bearer test-secret", "Origin": "https://evil.example"},
            403,
        ),
    ],
)
def test_auth_host_origin_before_data(headers: dict[str, str], expected: int) -> None:
    async def run() -> None:
        app = create_mcp_app(DemoBackend(), principals={"test-secret": "alex"})
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
            ) as client,
        ):
            response = await client.post(
                "/mcp",
                headers=headers,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-11-25",
                        "capabilities": {},
                        "clientInfo": {"name": "test", "version": "1"},
                    },
                },
            )
            assert response.status_code == expected
            assert "Анна" not in response.text
            assert (await client.get("/health/live")).json()["go_connected"] is False

    asyncio.run(run())


@pytest.mark.parametrize(
    "behavior",
    ["timeout", "exception", "bad_result", "oversize", "forbidden", "invalid_args"],
)
def test_safe_failures_through_gateway(behavior: str) -> None:
    class Broken:
        async def read(
            self, subject: str, tool: str, args: dict[str, Any]
        ) -> dict[str, Any]:
            if behavior == "timeout":
                await asyncio.sleep(1)
            if behavior == "exception":
                raise RuntimeError("private-provider-token")
            if behavior == "forbidden":
                raise ServiceError(ErrorCode.FORBIDDEN)
            if behavior == "oversize":
                # Valid individual fields, oversized aggregate.
                source = {
                    "id": "x",
                    "title": "я" * 200,
                    "url": "https://example.org/" + "я" * 1900,
                    "version": "1",
                    "is_demo": True,
                }
                return {
                    "ok": True,
                    "data": {
                        "documents": [{"source": source, "excerpt": "я" * 1200}] * 5
                    },
                }
            return {"ok": True, "data": {"secret": "private-provider-token"}}

    async def run() -> None:
        app = create_mcp_app(Broken(), principals={"test-secret": "alex"}, timeout=0.02)
        async with app.router.lifespan_context(app), connected(app) as gateway:
            if behavior == "invalid_args":
                async with (
                    httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=app),
                        headers={"Authorization": "Bearer test-secret"},
                    ) as client,
                    streamable_http_client(
                        "http://127.0.0.1/mcp", http_client=client
                    ) as (read, write, _),
                    ClientSession(read, write) as session,
                ):
                    await session.initialize()
                    r = await session.call_tool(
                        "get_team_context", {"subject_id": "other"}
                    )
                    assert r.structuredContent is not None
                    assert (
                        r.isError
                        and r.structuredContent["error"]["code"] == "INVALID_ARGUMENTS"
                    )
                return
            with pytest.raises(ServiceError) as e:
                await gateway.call("search_knowledge", {"query": "absence", "limit": 5})
            assert (
                e.value.code
                == {
                    "timeout": ErrorCode.MCP_TIMEOUT,
                    "exception": ErrorCode.TOOL_ERROR,
                    "bad_result": ErrorCode.INVALID_RESULT,
                    "oversize": ErrorCode.RESULT_TOO_LARGE,
                    "forbidden": ErrorCode.FORBIDDEN,
                }[behavior]
            )
            assert "private" not in str(e.value)

    asyncio.run(run())


def test_explicit_demo_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MCP_DEMO_ENABLED", raising=False)
    with pytest.raises(ValueError):
        create_demo_app()
    monkeypatch.setenv("MCP_DEMO_ENABLED", "true")
    monkeypatch.delenv("MCP_DEMO_TOKEN", raising=False)
    with pytest.raises(ValueError):
        create_demo_app()
    monkeypatch.setenv("MCP_DEMO_TOKEN", "local-secret")
    monkeypatch.setenv("MCP_DEMO_PROFILE", "missing")
    with pytest.raises(ValueError):
        create_demo_app()
    monkeypatch.setenv("MCP_DEMO_PROFILE", "alex")
    assert create_demo_app() is not None
