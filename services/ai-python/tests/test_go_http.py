"""Go HTTP boundary tests with synthetic responses, no Go/LLM dependencies."""

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Any

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from pydantic import SecretStr, ValidationError

from ai_buddy.app import create_app as create_flask
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.go_http import (
    ERRORS,
    GoHTTPBackend,
    GoHTTPSettings,
)
from ai_buddy.mcp_client import CONTRACTS, Gateway, Session, classified_error
from ai_buddy.mcp_identity import PRINCIPAL
from ai_buddy.mcp_server import create_app, create_mcp_app
from ai_buddy.schemas import TurnRequest
from tests.helpers import ReadRunner, context, request_json, settings

REQUEST_ID = "11111111-1111-4111-8111-111111111111"
CONVERSATION_ID = "22222222-2222-4222-8222-222222222222"
EMPTY_TEAM = {
    "ok": True,
    "data": {"team": None, "mentor": None, "lead": None, "references": []},
}


def active(subject: str = "alex", **updates: Any) -> dict[str, Any]:
    return {
        "active": True,
        "subject_id": subject,
        "request_id": REQUEST_ID,
        "conversation_id": CONVERSATION_ID,
        "allowed_tools": list(CONTRACTS),
        "expires_at": (datetime.now(UTC) + timedelta(seconds=60)).isoformat(),
        "api_token": "api-" + subject,
        **updates,
    }


class GoMock:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.contexts: dict[str, dict[str, Any]] = {
            "delegate-alex": active("alex"),
            "delegate-nina": active("nina"),
        }
        self.read_response: Callable[[httpx.Request], httpx.Response] | None = None

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        await asyncio.sleep(0)  # Interleave concurrent subjects deliberately.
        if request.url.path.endswith("/context/resolve"):
            assert request.headers["authorization"] == "Bearer adapter-secret"
            token = json.loads(request.content)["delegation_token"]
            return httpx.Response(200, json=self.contexts.get(token, {"active": False}))
        assert request.headers["authorization"].startswith("Bearer api-")
        assert request.headers["x-request-id"] == REQUEST_ID
        assert "delegate" not in request.content.decode()
        assert "adapter-secret" not in str(request.headers)
        assert "cookie" not in request.headers
        assert request.url.host == "127.0.0.1"
        if self.read_response:
            return self.read_response(request)
        if request.url.path.endswith("/knowledge/search"):
            assert request.method == "POST"
            assert json.loads(request.content) == {
                "query": "оформить отсутствие",
                "limit": 2,
            }
            return httpx.Response(200, json={"ok": True, "data": {"documents": []}})
        assert request.url.path == "/internal/v1/ai/team-context"
        assert request.method == "GET" and not request.content and not request.url.query
        value = json.loads(json.dumps(EMPTY_TEAM))
        name = request.headers["authorization"].removeprefix("Bearer api-")
        value["data"]["team"] = {"id": name, "name": name, "summary": "Учебная команда"}
        return httpx.Response(200, json=value)

    @property
    def reads(self) -> list[httpx.Request]:
        return [r for r in self.requests if not r.url.path.endswith("/context/resolve")]


def backend(handler: Any, **updates: Any) -> GoHTTPBackend:
    return GoHTTPBackend(
        GoHTTPSettings(
            url="http://127.0.0.1:8080",
            service_token=SecretStr("adapter-secret"),
            **updates,
        ),
        transport=httpx.MockTransport(handler),
    )


@asynccontextmanager
async def sdk(app: Any, req: TurnRequest) -> AsyncIterator[ClientSession]:
    try:
        async with (
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                headers={
                    "Authorization": "Bearer " + req.delegation_token.get_secret_value()
                },
            ) as client,
            streamable_http_client("http://127.0.0.1/mcp", http_client=client) as (
                read,
                write,
                _,
            ),
            ClientSession(read, write) as session,
        ):
            await session.initialize()
            yield session
    except Exception as error:  # noqa: BLE001 -- same sanitized SDK boundary as production
        raise classified_error(error) from None


def turn(subject: str = "alex", **updates: Any) -> TurnRequest:
    return context(
        request_id=REQUEST_ID,
        conversation_id=CONVERSATION_ID,
        delegation_token="delegate-" + subject,
        **updates,
    )


async def read_once(
    adapter: GoHTTPBackend,
    tool: str = "get_team_context",
    args: dict[str, Any] | None = None,
) -> dict[str, Any]:
    principal = await adapter.authenticate("delegate-alex")
    handle = PRINCIPAL.set(principal)
    try:
        return await adapter.read(principal.subject, tool, args or {})
    finally:
        PRINCIPAL.reset(handle)


def test_sdk_two_tools_and_concurrent_subjects() -> None:
    async def run() -> None:
        go = GoMock()
        adapter = backend(go)
        app = create_mcp_app(adapter, authenticator=adapter, mode="go_http")

        async def one(subject: str) -> str:
            req = turn(subject)
            async with sdk(app, req) as session:
                gateway = Gateway(session, req, settings())
                assert await gateway.discover() == frozenset(CONTRACTS)
                assert await gateway.call(
                    "search_knowledge", {"query": "  оформить  отсутствие ", "limit": 2}
                ) == {"documents": []}
                return str((await gateway.call("get_team_context", {}))["team"]["id"])

        async with app.router.lifespan_context(app):
            first, second = await asyncio.gather(one("alex"), one("nina"))
            assert (first, second) == ("alex", "nina")
        assert len(go.reads) == 4
        with pytest.raises(LookupError):
            PRINCIPAL.get()

    asyncio.run(run())


@pytest.mark.parametrize(
    "changes",
    [
        {"extra": "secret"},
        {"active": 1},
        {"active": "true"},
        {"subject_id": " "},
        {"request_id": "invalid"},
        {"conversation_id": "invalid"},
        {"expires_at": "2026-11-14T01:00:00"},
        {"expires_at": "2099-01-01T01:00:00+01:00"},
        {"allowed_tools": ["get_team_context", "get_team_context"]},
        {"allowed_tools": ["advance_stage"]},
        {"api_token": "delegate-alex"},
        {"api_token": "adapter-secret"},
        {"api_token": "bad token"},
        {"api_token": "токен"},
        {"active": False},
    ],
)
def test_resolve_closed_context(changes: dict[str, Any]) -> None:
    async def run() -> None:
        go = GoMock()
        go.contexts["delegate-alex"] = active(**changes)
        with pytest.raises(ServiceError) as captured:
            await backend(go).authenticate("delegate-alex")
        assert captured.value.code == ErrorCode.INVALID_RESULT
        assert not go.reads

    asyncio.run(run())


@pytest.mark.parametrize(
    "value", [{"active": False}, active(expires_at="2000-01-01T00:00:00Z")]
)
def test_inactive_or_expired_context(value: dict[str, Any]) -> None:
    async def run() -> None:
        go = GoMock()
        go.contexts["delegate-alex"] = value
        with pytest.raises(ServiceError) as captured:
            await backend(go).authenticate("delegate-alex")
        assert captured.value.code == ErrorCode.UNAUTHORIZED

    asyncio.run(run())


@pytest.mark.parametrize("status", [400, 401, 403, 404, 429, 503, 500, 201, 302])
def test_resolve_upstream_failure_never_authenticates(status: int) -> None:
    async def run() -> None:
        adapter = backend(
            lambda request: httpx.Response(status, json={"private": "secret"})
        )
        with pytest.raises(ServiceError):
            await adapter.authenticate("delegate-alex")

    asyncio.run(run())


@pytest.mark.parametrize(
    ("status", "expected"),
    list(ERRORS.items()) + [(500, ErrorCode.TOOL_ERROR), (201, ErrorCode.TOOL_ERROR)],
)
def test_http_error_mapping_is_safe_without_retries(
    status: int, expected: ErrorCode, caplog: pytest.LogCaptureFixture
) -> None:
    async def run() -> None:
        go = GoMock()
        go.read_response = lambda request: httpx.Response(
            status,
            json={
                "ok": False,
                "error": {
                    "code": expected.value if status != 500 else "INTERNAL_ERROR",
                    "message": "private-body-token",
                    "retryable": True,
                },
            },
        )
        with pytest.raises(ServiceError) as captured:
            await read_once(backend(go))
        assert captured.value.code == expected
        assert "private" not in str(captured.value)
        assert len(go.reads) == 1

    asyncio.run(run())
    assert "private-body-token" not in caplog.text
    assert "adapter-secret" not in caplog.text


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (
            lambda: httpx.Response(302, headers={"location": "https://evil.example/"}),
            ErrorCode.TOOL_ERROR,
        ),
        (
            lambda: httpx.Response(200, text="private-provider-html"),
            ErrorCode.INVALID_RESULT,
        ),
        (
            lambda: httpx.Response(
                200, content=b"{", headers={"content-type": "application/json"}
            ),
            ErrorCode.INVALID_RESULT,
        ),
        (
            lambda: httpx.Response(
                200,
                content=b'{"ok":true,"ok":true}',
                headers={"content-type": "application/json"},
            ),
            ErrorCode.INVALID_RESULT,
        ),
        (
            lambda: httpx.Response(
                200, content=b'{"ok":NaN}', headers={"content-type": "application/json"}
            ),
            ErrorCode.INVALID_RESULT,
        ),
        (
            lambda: httpx.Response(200, json={**EMPTY_TEAM, "secret": "private"}),
            ErrorCode.INVALID_RESULT,
        ),
        (
            lambda: httpx.Response(200, json={**EMPTY_TEAM, "ok": 1}),
            ErrorCode.INVALID_RESULT,
        ),
        (lambda: httpx.Response(200, json=[]), ErrorCode.INVALID_RESULT),
        (
            lambda: httpx.Response(200, json={"ok": True, "data": {"documents": []}}),
            ErrorCode.INVALID_RESULT,
        ),
        (
            lambda: httpx.Response(
                403,
                json={
                    "ok": False,
                    "error": {
                        "code": "NOT_FOUND",
                        "message": "private",
                        "retryable": False,
                    },
                },
            ),
            ErrorCode.INVALID_RESULT,
        ),
        (
            lambda: httpx.Response(
                200, json=EMPTY_TEAM, headers={"content-length": "32769"}
            ),
            ErrorCode.RESULT_TOO_LARGE,
        ),
        (
            lambda: httpx.Response(
                200, json=EMPTY_TEAM, headers={"content-length": "bad"}
            ),
            ErrorCode.INVALID_RESULT,
        ),
    ],
)
def test_invalid_http_results(
    response: Callable[[], httpx.Response], expected: ErrorCode
) -> None:
    async def run() -> None:
        go = GoMock()
        go.read_response = lambda request: response()
        with pytest.raises(ServiceError) as captured:
            await read_once(backend(go))
        assert captured.value.code == expected
        assert len(go.reads) == 1

    asyncio.run(run())


class Chunks(httpx.AsyncByteStream):
    def __init__(self, *, delay: float = 0, size: int = 0) -> None:
        self.delay, self.size = delay, size
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for _ in range(10):
            await asyncio.sleep(self.delay)
            yield b"x" * self.size

    async def aclose(self) -> None:
        self.closed = True


@pytest.mark.parametrize(
    ("phase", "kind"),
    [
        (p, k)
        for p in ("resolve", "read")
        for k in ("connect", "http_timeout", "slow_headers", "slow_chunks", "oversize")
    ],
)
def test_timeouts_network_size_and_cleanup(phase: str, kind: str) -> None:
    async def run() -> None:
        go = GoMock()
        chunks = Chunks(
            delay=0.01 if kind == "slow_chunks" else 0,
            size=4000 if kind == "oversize" else 1,
        )
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            resolve = request.url.path.endswith("/context/resolve")
            if resolve != (phase == "resolve"):
                return await go(request)
            calls += 1
            if kind == "connect":
                raise httpx.ConnectError("private-url-token")
            if kind == "http_timeout":
                raise httpx.ReadTimeout("private-url-token")
            if kind == "slow_headers":
                await asyncio.sleep(1)
            return httpx.Response(
                200, headers={"content-type": "application/json"}, stream=chunks
            )

        adapter = backend(handler, resolve_timeout=0.03, read_timeout=0.03)
        with pytest.raises(ServiceError) as captured:
            if phase == "resolve":
                await adapter.authenticate("delegate-alex")
            else:
                await read_once(adapter)
        assert captured.value.code == (
            ErrorCode.RESULT_TOO_LARGE
            if kind == "oversize"
            else ErrorCode.TEMPORARILY_UNAVAILABLE
        )
        assert calls == 1
        if kind in {"slow_chunks", "oversize"}:
            assert chunks.closed

    asyncio.run(run())


def test_cancellation_closes_stream_and_clears_context() -> None:
    async def run() -> None:
        go = GoMock()
        started = asyncio.Event()
        chunks = Chunks(delay=10)

        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/context/resolve"):
                return await go(request)
            started.set()
            return httpx.Response(
                200, headers={"content-type": "application/json"}, stream=chunks
            )

        task = asyncio.create_task(read_once(backend(handler)))
        await asyncio.wait_for(started.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert chunks.closed
        with pytest.raises(LookupError):
            PRINCIPAL.get()

    asyncio.run(run())


@pytest.mark.parametrize(
    "url",
    [
        "",
        "http://go.example",
        "https://user:pass@go.example",
        "https://@go.example",
        "https://go.example/path",
        "https://go.example?",
        "https://go.example#",
        "https://go.example:0",
        "https://go.example:99999",
        "https://go.example\\evil",
        "https://go.example\n",
        "https://go.example /",
        "file:///tmp/go",
    ],
)
def test_go_origin_configuration(url: str) -> None:
    with pytest.raises((ValidationError, ValueError)):
        GoHTTPSettings(url=url, service_token=SecretStr("secret"))


def test_explicit_modes_and_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MCP_BACKEND", "go_http")
    monkeypatch.delenv("GO_API_URL", raising=False)
    monkeypatch.delenv("MCP_ADAPTER_SERVICE_TOKEN", raising=False)
    with pytest.raises(ValueError):
        create_app()
    monkeypatch.setenv("GO_API_URL", "https://go.example/")
    monkeypatch.setenv("MCP_ADAPTER_SERVICE_TOKEN", "service-secret")
    assert create_app() is not None
    assert GoHTTPSettings.from_env().url == "https://go.example"
    monkeypatch.setenv("MCP_BACKEND", "other")
    with pytest.raises(ValueError):
        create_app()
    monkeypatch.setenv("MCP_BACKEND", "demo")
    monkeypatch.setenv("MCP_DEMO_ENABLED", "true")
    monkeypatch.setenv("MCP_DEMO_TOKEN", "demo-secret")
    monkeypatch.setenv("MCP_DEMO_PROFILE", "alex")
    assert create_app() is not None
    for token in ("", "with space", "токен", "x" * 8193):
        with pytest.raises(ValueError):
            GoHTTPSettings(url="http://localhost", service_token=SecretStr(token))


@pytest.mark.parametrize(
    "meta",
    [
        None,
        {"ai-buddy.example/request-id": CONVERSATION_ID},
        {"ai-buddy.example/request-id": "invalid"},
    ],
)
def test_sdk_requires_bound_request_id_before_read(meta: dict[str, Any] | None) -> None:
    async def run() -> None:
        go = GoMock()
        adapter = backend(go)
        app = create_mcp_app(adapter, authenticator=adapter, mode="go_http")
        async with app.router.lifespan_context(app), sdk(app, turn()) as session:
            result = await session.call_tool("get_team_context", {}, meta=meta)
            assert result.isError
            assert result.structuredContent is not None
            assert result.structuredContent["error"]["code"] in {
                "FORBIDDEN",
                "INVALID_ARGUMENTS",
            }
        assert not go.reads

    asyncio.run(run())


def test_sdk_grants_revocation_and_closed_arguments() -> None:
    async def run() -> None:
        go = GoMock()
        go.contexts["delegate-alex"]["allowed_tools"] = ["search_knowledge"]
        adapter = backend(go)
        app = create_mcp_app(adapter, authenticator=adapter, mode="go_http")
        async with app.router.lifespan_context(app), sdk(app, turn()) as session:
            assert [t.name for t in (await session.list_tools()).tools] == [
                "search_knowledge"
            ]
            denied = await session.call_tool(
                "get_team_context", {}, meta={"ai-buddy.example/request-id": REQUEST_ID}
            )
            assert (
                denied.isError
                and denied.structuredContent
                and denied.structuredContent["error"]["code"] == "FORBIDDEN"
            )
            invalid = await session.call_tool(
                "search_knowledge",
                {"query": "q", "subject_id": "nina"},
                meta={"ai-buddy.example/request-id": REQUEST_ID},
            )
            assert invalid.isError
            unknown = await session.call_tool(
                "advance_stage", {}, meta={"ai-buddy.example/request-id": REQUEST_ID}
            )
            assert (
                unknown.isError
                and unknown.structuredContent
                and unknown.structuredContent["error"]["code"] == "INVALID_TOOL"
            )
            go.contexts["delegate-alex"]["allowed_tools"] = []
            assert (await session.list_tools()).tools == []
        assert not go.reads
        go.contexts["delegate-alex"] = {"active": False}
        app = create_mcp_app(adapter, authenticator=adapter, mode="go_http")
        async with app.router.lifespan_context(app):
            with pytest.raises(ServiceError) as captured:
                async with sdk(app, turn()):
                    pytest.fail("revoked delegation must fail initialize")
        assert captured.value.code == ErrorCode.MCP_UNAVAILABLE

    asyncio.run(run())


@pytest.mark.parametrize("fault", [None, "forbidden", "timeout", "resolve_timeout"])
def test_flask_to_sdk_to_go_http_mock(fault: str | None) -> None:
    go = GoMock()
    go.read_response = lambda request: httpx.Response(
        200, json={"ok": True, "data": {"documents": []}}
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        if fault == "resolve_timeout" and request.url.path.endswith("/context/resolve"):
            await asyncio.sleep(1)
        if not request.url.path.endswith("/context/resolve"):
            if fault == "timeout":
                await asyncio.sleep(1)
            if fault == "forbidden":
                return httpx.Response(
                    403,
                    json={
                        "ok": False,
                        "error": {
                            "code": "FORBIDDEN",
                            "message": "private",
                            "retryable": False,
                        },
                    },
                )
        return await go(request)

    adapter = backend(handler, resolve_timeout=0.02, read_timeout=0.02)

    @asynccontextmanager
    async def factory(req: TurnRequest) -> AsyncIterator[Session]:
        app = create_mcp_app(adapter, authenticator=adapter, mode="go_http")
        try:
            async with app.router.lifespan_context(app), sdk(app, req) as session:
                yield session
        except Exception as error:  # noqa: BLE001 -- server lifespan groups SDK errors
            raise classified_error(error) from None

    app = create_flask(settings(), runner=ReadRunner(), session_factory=factory)
    response = app.test_client().post(
        "/internal/v1/turns",
        data=request_json(turn(message="оформить отсутствие")),
        content_type="application/json",
        headers={"Authorization": "Bearer service-secret"},
    )
    if fault is None:
        assert response.status_code == 200
    else:
        assert response.status_code == 503
        assert response.json is not None
        assert (
            response.json["error"]["code"]
            == {
                "forbidden": "FORBIDDEN",
                "timeout": "TEMPORARILY_UNAVAILABLE",
                "resolve_timeout": "MCP_UNAVAILABLE",
            }[fault]
        )


def test_successful_documents_and_requested_limit() -> None:
    async def run() -> None:
        go = GoMock()
        document = {
            "source": {
                "id": "guide",
                "title": "Учебная инструкция",
                "url": "https://demo.example/guide",
                "version": "1",
                "is_demo": True,
            },
            "excerpt": "Подай заявку.",
        }
        go.read_response = lambda request: httpx.Response(
            200, json={"ok": True, "data": {"documents": [document]}}
        )
        adapter = backend(go)
        assert (
            await read_once(
                adapter, "search_knowledge", {"query": "  доступ ", "limit": 1}
            )
        )["data"]["documents"] == [document]
        assert json.loads(go.reads[0].content) == {"query": "доступ", "limit": 1}
        go.read_response = lambda request: httpx.Response(
            200, json={"ok": True, "data": {"documents": [document] * 2}}
        )
        with pytest.raises(ServiceError) as captured:
            await read_once(
                adapter, "search_knowledge", {"query": "доступ", "limit": 1}
            )
        assert captured.value.code == ErrorCode.INVALID_RESULT
        go.read_response = lambda request: httpx.Response(200, json=EMPTY_TEAM)
        assert await read_once(adapter) == EMPTY_TEAM

    asyncio.run(run())


def test_direct_backend_requires_valid_subject_grant_arguments_and_expiry() -> None:
    async def run() -> None:
        go = GoMock()
        adapter = backend(go)
        principal = await adapter.authenticate("delegate-alex")
        cases: list[tuple[dict[str, Any], str, str, dict[str, Any], ErrorCode]] = [
            ({}, "nina", "get_team_context", {}, ErrorCode.FORBIDDEN),
            (
                {"allowed_tools": frozenset()},
                "alex",
                "get_team_context",
                {},
                ErrorCode.FORBIDDEN,
            ),
            (
                {"api_token": None},
                "alex",
                "get_team_context",
                {},
                ErrorCode.CONTEXT_EXPIRED,
            ),
            (
                {"expires_at": datetime(2000, 1, 1, tzinfo=UTC)},
                "alex",
                "get_team_context",
                {},
                ErrorCode.CONTEXT_EXPIRED,
            ),
            (
                {},
                "alex",
                "get_team_context",
                {"subject_id": "nina"},
                ErrorCode.INVALID_ARGUMENTS,
            ),
        ]
        for updates, subject, tool, args, expected in cases:
            handle = PRINCIPAL.set(principal.model_copy(update=updates))
            try:
                with pytest.raises(ServiceError) as captured:
                    await adapter.read(subject, tool, args)
                assert captured.value.code == expected
            finally:
                PRINCIPAL.reset(handle)
        assert not go.reads

    asyncio.run(run())


@pytest.mark.parametrize("delay", [True, False])
def test_expiry_limits_slow_read_and_discards_late_response(
    delay: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def run() -> None:
        go = GoMock()
        adapter = backend(go)
        principal = await adapter.authenticate("delegate-alex")
        expiry = datetime.now(UTC) + timedelta(seconds=0.025)
        handle = PRINCIPAL.set(principal.model_copy(update={"expires_at": expiry}))
        elapsed = timedelta(0)

        class Clock:
            @staticmethod
            def now(zone: tzinfo) -> datetime:
                return datetime.now(zone) + elapsed

        monkeypatch.setattr("ai_buddy.go_http.datetime", Clock)

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal elapsed
            if delay:
                await asyncio.sleep(1)
            else:
                elapsed = timedelta(seconds=1)
            return httpx.Response(200, json=EMPTY_TEAM)

        adapter.transport = httpx.MockTransport(handler)
        try:
            with pytest.raises(ServiceError) as captured:
                await adapter.read("alex", "get_team_context", {})
            assert captured.value.code == ErrorCode.CONTEXT_EXPIRED
        finally:
            PRINCIPAL.reset(handle)

    asyncio.run(run())


def test_inbound_checks_avoid_go_and_health_does_not_probe() -> None:
    async def run() -> None:
        go = GoMock()
        adapter = backend(go)
        app = create_mcp_app(adapter, authenticator=adapter, mode="go_http")
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
            ) as client,
        ):
            for headers, status in [
                ([], 401),
                (
                    [
                        ("Authorization", "Bearer delegate-alex"),
                        ("Authorization", "Bearer delegate-nina"),
                    ],
                    401,
                ),
                ([("Authorization", "Bearer has space")], 401),
                ([("Authorization", "Bearer " + "x" * 8193)], 401),
                (
                    [
                        ("Authorization", "Bearer delegate-alex"),
                        ("Host", "evil.example"),
                    ],
                    421,
                ),
                (
                    [
                        ("Authorization", "Bearer delegate-alex"),
                        ("Origin", "https://evil.example"),
                    ],
                    403,
                ),
            ]:
                response = await client.post("/mcp", json={}, headers=headers)
                assert response.status_code == status
            assert (await client.get("/health/live")).json() == {
                "status": "alive",
                "mode": "go_http",
                "go_connected": None,
            }
            oversized = await client.post(
                "/mcp",
                content=b"x" * 65537,
                headers={
                    "Authorization": "Bearer delegate-alex",
                    "Content-Type": "application/json",
                },
            )
            assert oversized.status_code == 413
        assert not go.requests

    asyncio.run(run())


@pytest.mark.parametrize("token", ["", "токен", "bad token", "x" * 8193])
def test_invalid_delegation_never_reaches_resolve(token: str) -> None:
    async def run() -> None:
        go = GoMock()
        with pytest.raises(ServiceError) as captured:
            await backend(go).authenticate(token)
        assert captured.value.code == ErrorCode.UNAUTHORIZED
        assert not go.requests

    asyncio.run(run())


def test_compressed_response_rejected_before_decoding_and_stream_closed() -> None:
    async def run() -> None:
        go = GoMock()
        chunks = Chunks(size=1)
        go.read_response = lambda request: httpx.Response(
            200,
            headers={"content-type": "application/json", "content-encoding": "gzip"},
            stream=chunks,
        )
        with pytest.raises(ServiceError) as captured:
            await read_once(backend(go))
        assert captured.value.code == ErrorCode.INVALID_RESULT
        assert chunks.closed

    asyncio.run(run())


def test_sdk_auth_failure_sanitizes_resolve_and_never_reads() -> None:
    async def run() -> None:
        calls: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return httpx.Response(401, json={"secret": "private-resolve-details"})

        adapter = backend(handler)
        app = create_mcp_app(adapter, authenticator=adapter, mode="go_http")
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
            ) as client,
        ):
            response = await client.post(
                "/mcp", json={}, headers={"Authorization": "Bearer delegate-alex"}
            )
            assert response.status_code == 503
            assert response.json() == {"error": "MCP_UNAVAILABLE"}
        assert all(r.url.path.endswith("/context/resolve") for r in calls)

    asyncio.run(run())
