import asyncio
import json
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

import httpx
import pytest
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager

from ai_buddy.errors import ServiceError
from ai_buddy.mcp_client import CONTRACTS, Gateway, sdk_session
from tests.helpers import context, result, settings


def test_sdk_streamable_http_handshake_calls_and_isolation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        server = Server("foundation-test")
        bodies: list[dict[str, Any]] = []
        credentials: list[str] = []

        @server.list_tools()  # type: ignore[no-untyped-call,untyped-decorator]  # SDK decorator is untyped
        async def tools() -> list[types.Tool]:
            return [
                types.Tool(name=name, inputSchema=c.arguments.model_json_schema())
                for name, c in CONTRACTS.items()
            ]

        @server.call_tool()  # type: ignore[untyped-decorator]  # SDK decorator is untyped
        async def call(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
            if name == "search_knowledge":
                return result({"ok": True, "data": {"documents": []}})
            return result(
                {
                    "ok": True,
                    "data": {
                        "team": None,
                        "mentor": None,
                        "lead": None,
                        "references": [],
                    },
                }
            )

        manager = StreamableHTTPSessionManager(
            server, stateless=True, json_response=True
        )

        async def app(
            scope: MutableMapping[str, Any],
            receive: Callable[[], Awaitable[MutableMapping[str, Any]]],
            send: Callable[[MutableMapping[str, Any]], Awaitable[None]],
        ) -> None:
            headers = dict(scope["headers"])
            credentials.append(headers.get(b"authorization", b"").decode())

            async def capture() -> MutableMapping[str, Any]:
                message = await receive()
                body = message.get("body", b"")
                if body:
                    bodies.append(json.loads(body))
                return message

            await manager.handle_request(scope, capture, send)

        monkeypatch.setattr(
            httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.ASGITransport(app=app)
        )

        async def one(token: str) -> str:
            req = context(delegation_token=token)
            async with sdk_session(settings(), req) as session:
                gateway = Gateway(session, req, settings())
                assert await gateway.discover() == frozenset(CONTRACTS)
                assert await gateway.call("search_knowledge", {"query": "help"}) == {
                    "documents": []
                }
                assert (await gateway.call("get_team_context", {}))["team"] is None
            return str(req.request_id)

        async with manager.run():
            ids = await asyncio.gather(one("alice-token"), one("bob-token"))
        calls = [b for b in bodies if b.get("method") == "tools/call"]
        assert {
            b["params"]["_meta"]["ai-buddy.example/request-id"] for b in calls
        } == set(ids)
        assert set(credentials) == {"Bearer alice-token", "Bearer bob-token"}
        assert len(calls) == 4

    asyncio.run(run())


def test_sdk_network_failure_is_sanitized(monkeypatch: pytest.MonkeyPatch) -> None:
    async def run() -> None:
        def failed(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("private-network-details")

        monkeypatch.setattr(
            httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.MockTransport(failed)
        )
        with pytest.raises(ServiceError) as captured:
            async with sdk_session(settings(), context()):
                pytest.fail("connection must fail")
        assert "private-network-details" not in str(captured.value)

    asyncio.run(run())
