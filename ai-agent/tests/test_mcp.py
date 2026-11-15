import asyncio
from typing import Any

import httpx
import pytest
from mcp import types
from pydantic import ValidationError

from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import (
    MAX_TRANSPORT_BYTES,
    Gateway,
    LimitedStream,
    LimitedTransport,
    canonical_schema,
    classified_error,
    sdk_session,
)
from ai_buddy.schemas import PageContext, Reference
from tests.helpers import FakeSession, context, result, settings


def invoke(
    session: FakeSession,
    name: str = "search_knowledge",
    arguments: dict[str, Any] | None = None,
) -> dict[str, Any]:
    async def run() -> dict[str, Any]:
        client = Gateway(session, context(), settings())
        await client.discover()
        return await client.call(
            name, arguments if arguments is not None else {"query": "help"}
        )

    return asyncio.run(run())


def test_discovery_uses_allowlist_and_validates_schema() -> None:
    session = FakeSession()
    session.pages.tools.append(types.Tool(name="advance_stage", inputSchema={}))
    with pytest.raises(ServiceError, match="INVALID_TOOL"):
        invoke(session, "advance_stage", {})
    assert not session.calls
    session.pages.tools[0].inputSchema = {"type": "object"}
    with pytest.raises(ServiceError, match="INCOMPATIBLE_SCHEMA"):
        invoke(session)


def test_repeated_catalog_page_is_bounded() -> None:
    session = FakeSession()
    session.pages.nextCursor = "again"
    session.pages.tools = []
    with pytest.raises(ServiceError, match="AGENT_LIMIT_REACHED"):
        invoke(session)


def test_duplicate_tool_is_rejected() -> None:
    session = FakeSession()
    session.pages.tools.append(session.pages.tools[0])
    with pytest.raises(ServiceError, match="INCOMPATIBLE_SCHEMA"):
        invoke(session)


@pytest.mark.parametrize(
    "arguments",
    [
        {"query": " "},
        {"query": "a" * 501},
        {"query": "ok", "subject_id": "other"},
        {"query": "ok", "limit": True},
        {"query": "ok", "limit": 6},
    ],
)
def test_invalid_arguments_do_not_execute(arguments: dict[str, Any]) -> None:
    session = FakeSession()
    with pytest.raises(ServiceError, match="INVALID_ARGUMENTS"):
        invoke(session, arguments=arguments)
    assert not session.calls


def test_normalization_and_trusted_metadata() -> None:
    session = FakeSession()
    assert invoke(session, arguments={"query": "  как  оформить\nотгул "}) == {
        "documents": []
    }
    name, args, meta = session.calls[0]
    assert name == "search_knowledge"
    assert args == {"query": "как оформить отгул", "limit": 3}
    assert set(meta) == {"ai-buddy.example/request-id"}


@pytest.mark.parametrize(
    "payload",
    [
        {"ok": True, "data": {"documents": []}, "extra": 1},
        {"ok": True, "data": {"documents": "bad"}},
        {
            "ok": False,
            "error": {"code": "FORBIDDEN", "message": "private", "retryable": False},
        },
    ],
)
def test_invalid_success_payload(payload: dict[str, Any]) -> None:
    session = FakeSession()
    session.response = result(payload)
    with pytest.raises(ServiceError, match="INVALID_RESULT"):
        invoke(session)


def test_domain_error_does_not_expose_message() -> None:
    session = FakeSession()
    session.response = result(
        {
            "ok": False,
            "error": {"code": "FORBIDDEN", "message": "secret", "retryable": False},
        },
        error=True,
    )
    with pytest.raises(ServiceError, match="FORBIDDEN") as captured:
        invoke(session)
    assert "secret" not in str(captured.value)
    assert len(session.calls) == 1


def test_text_structured_mismatch() -> None:
    session = FakeSession()
    session.response.content = [types.TextContent(type="text", text='{"ok":false}')]
    with pytest.raises(ServiceError, match="INVALID_RESULT"):
        invoke(session)


@pytest.mark.parametrize("text", ["not json", "{}"])
def test_invalid_text(text: str) -> None:
    session = FakeSession()
    session.response.content = [types.TextContent(type="text", text=text)]
    with pytest.raises(ServiceError, match="INVALID_RESULT"):
        invoke(session)


def test_no_structured_content_and_size_limit() -> None:
    session = FakeSession()
    session.response.structuredContent = None
    with pytest.raises(ServiceError, match="INVALID_RESULT"):
        invoke(session)
    session.response.content = [types.TextContent(type="text", text="x" * 33000)]
    with pytest.raises(ServiceError, match="RESULT_TOO_LARGE"):
        invoke(session)


def test_search_limit_and_source_validation() -> None:
    doc = {
        "source": {
            "id": "doc",
            "title": "Guide",
            "url": "/guide",
            "version": "1",
            "is_demo": True,
        },
        "excerpt": "demo",
    }
    session = FakeSession()
    session.response = result({"ok": True, "data": {"documents": [doc, doc]}})
    with pytest.raises(ServiceError, match="INVALID_RESULT"):
        invoke(session, arguments={"query": "help", "limit": 1})
    doc["source"]["url"] = "javascript:alert(1)"  # type: ignore[index]
    session.response = result({"ok": True, "data": {"documents": [doc]}})
    with pytest.raises(ServiceError, match="INVALID_RESULT"):
        invoke(session)


def test_team_nulls_are_explicit() -> None:
    session = FakeSession()
    session.response = result(
        {
            "ok": True,
            "data": {"team": None, "mentor": None, "lead": None, "references": []},
        }
    )
    assert invoke(session, "get_team_context", {})["team"] is None


def test_attempt_budget() -> None:
    async def run() -> None:
        s = FakeSession()
        client = Gateway(s, context(), settings(max_tool_calls=1))
        await client.discover()
        await client.call("search_knowledge", {"query": "one"})
        with pytest.raises(ServiceError, match="AGENT_LIMIT_REACHED"):
            await client.call("search_knowledge", {"query": "two"})
        assert len(s.calls) == 1

    asyncio.run(run())


def test_timeout_and_no_retry() -> None:
    session = FakeSession()
    session.failure = TimeoutError("secret")
    with pytest.raises(ServiceError, match="MCP_TIMEOUT"):
        invoke(session)
    assert len(session.calls) == 1


def test_nested_errors_preserve_safe_classification() -> None:
    assert (
        classified_error(
            ExceptionGroup(
                "unsafe",
                [RuntimeError("secret"), ServiceError(ErrorCode.RESULT_TOO_LARGE)],
            )
        ).code
        == ErrorCode.RESULT_TOO_LARGE
    )
    assert (
        classified_error(ExceptionGroup("unsafe", [TimeoutError()])).code
        == ErrorCode.MCP_TIMEOUT
    )
    assert classified_error(RuntimeError("secret")).code == ErrorCode.MCP_UNAVAILABLE
    assert canonical_schema(
        {"title": "ignore", "items": [{"description": "ignore", "type": "string"}]}
    ) == {"items": [{"type": "string"}]}


def test_sdk_without_configuration() -> None:
    async def run() -> None:
        from ai_buddy.config import Settings

        with pytest.raises(ServiceError, match="NOT_READY"):
            async with sdk_session(Settings(), context()):
                pytest.fail("must not connect")

    asyncio.run(run())


def test_stream_limit_and_transport_cleanup() -> None:
    async def run() -> None:
        stream = LimitedStream(httpx.ByteStream(b"x" * (MAX_TRANSPORT_BYTES + 1)))
        with pytest.raises(ServiceError, match="RESULT_TOO_LARGE"):
            async for _ in stream:
                pass
        await stream.aclose()

        async def respond(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"ok")

        async with httpx.AsyncClient(
            transport=LimitedTransport(httpx.MockTransport(respond))
        ) as client:
            assert (await client.get("http://example.org/mcp")).content == b"ok"

    asyncio.run(run())


def test_redirect_rejected_before_credentials_can_be_replayed() -> None:
    async def run() -> None:
        seen: list[str] = []

        def respond(request: httpx.Request) -> httpx.Response:
            seen.append(str(request.url))
            return httpx.Response(307, headers={"Location": "http://other.invalid/mcp"})

        async with httpx.AsyncClient(
            transport=LimitedTransport(httpx.MockTransport(respond)),
            follow_redirects=True,
        ) as client:
            with pytest.raises(ServiceError, match="MCP_UNAVAILABLE"):
                await client.get("http://example.org/mcp")
        assert len(seen) == 1

    asyncio.run(run())


@pytest.mark.parametrize(
    "url", ["javascript:alert(1)", "data:text/plain,x", "https://user:pass@example.org"]
)
def test_reference_url_validation(url: str) -> None:
    with pytest.raises(ValidationError):
        Reference(title="x", url=url)
    assert Reference(title="x", url="/guide").url == "/guide"
    assert PageContext(url="https://example.org/path").url.endswith("/path")


@pytest.mark.parametrize("url", ["/\\evil.example/path", "https://example.org/\npath"])
def test_unsafe_url_characters(url: str) -> None:
    with pytest.raises(ValidationError):
        Reference(title="x", url=url)


def test_numeric_ok_is_not_a_boolean() -> None:
    session = FakeSession()
    session.response = result({"ok": 1, "data": {"documents": []}})
    with pytest.raises(ServiceError, match="INVALID_RESULT"):
        invoke(session)


def test_discovery_timeout_is_safe() -> None:
    class SlowDiscovery(FakeSession):
        async def list_tools(self, cursor: str | None = None) -> types.ListToolsResult:
            await asyncio.sleep(1)
            return self.pages

    async def run() -> None:
        gateway = Gateway(SlowDiscovery(), context(), settings(tool_timeout=0.01))
        with pytest.raises(ServiceError, match="MCP_TIMEOUT"):
            await gateway.discover()

    asyncio.run(run())
