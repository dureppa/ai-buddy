"""Boundary regressions for the real Flask runner; all dependencies are offline."""

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Coroutine
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from mcp import types

from ai_buddy import create_app
from ai_buddy.config import Settings
from experiments.mcp_fixture import payload
from tests.helpers import (
    FakeFactory,
    FakeSession,
    context,
    request_json,
    result,
    settings,
)
from tests.test_app import HEADERS


def model_response(content: str = "Нужно уточнение.", **updates: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "done": True,
        "done_reason": "stop",
        "message": {"role": "assistant", "content": content},
    }
    body.update(updates)
    return body


def tool_message(name: str = "get_team_context") -> dict[str, Any]:
    return model_response(
        message={
            "role": "assistant",
            "content": "",
            "tool_calls": [{"function": {"name": name, "arguments": {}}}],
        }
    )


class RuntimeSession(FakeSession):
    async def call_tool(
        self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
    ) -> types.CallToolResult:
        await super().call_tool(name, arguments, meta=meta)
        data = payload(name, "mentor")
        if name == "get_onboarding_progress":
            data = {
                "tasks": [],
                "next_task_id": None,
                "references": [payload("get_team_context", "mentor")["references"][0]],
            }
        return result({"ok": True, "data": data})


def runtime_client(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response]
    | Callable[[httpx.Request], Coroutine[None, None, httpx.Response]],
    **config: Any,
) -> tuple[Any, FakeFactory]:
    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.MockTransport(handler)
    )
    session = RuntimeSession()
    session.response = result(
        {"ok": True, "data": payload("get_team_context", "mentor")}
    )
    factory = FakeFactory(session)
    client = create_app(
        settings(agent_enabled=True, ollama_model="qwen3:4b-q4_K_M", **config),
        session_factory=factory,
    ).test_client()
    return client, factory


def post(client: Any, **updates: Any) -> Any:
    return client.post(
        "/internal/v1/turns",
        data=request_json(context(**updates)),
        headers=HEADERS,
        content_type="application/json",
    )


def test_automatic_runner_handles_history_evidence_and_isolates_turns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, Any]] = []
    responses = iter(
        [
            model_response("Анна Тестова @demo_mentor [guide]"),
            model_response("Нужно уточнение."),
        ]
    )

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        assert "authorization" not in request.headers
        return httpx.Response(200, json=next(responses))

    client, factory = runtime_client(monkeypatch, handle)
    assert client.get("/health/ready").json == {"ready": True}
    first = post(
        client,
        message="Кто наставник?",
        history=[
            {"role": "user", "content": "Я новичок"},
            {"role": "assistant", "content": "Привет"},
        ],
        page_context={"url": "https://demo.example/team"},
    )
    assert first.status_code == 200
    assert first.json["reply"] == {
        "text": "Анна Тестова @demo_mentor",
        "references": [{"title": "Демо-памятка", "url": "https://demo.example/guide"}],
    }
    second = post(client, message="Привет", delegation_token="second-delegation")
    assert second.status_code == 200
    assert second.json["reply"]["references"] == []
    assert "Я новичок" in json.dumps(requests[0], ensure_ascii=False)
    assert "Я новичок" not in json.dumps(requests[1], ensure_ascii=False)
    assert "DOM неизвестен" in json.dumps(requests[0], ensure_ascii=False)
    serialized = json.dumps(requests)
    assert (
        "delegated-secret" not in serialized and "second-delegation" not in serialized
    )
    assert requests[0]["stream"] is False and requests[0]["think"] is False
    assert factory.closed == ["delegated-secret", "second-delegation"]


@pytest.mark.parametrize(
    ("failure", "code"),
    [
        (httpx.ConnectError("private-provider-body"), "AI_UNAVAILABLE"),
        (httpx.ReadTimeout("private-provider-body"), "AI_TIMEOUT"),
        (429, "AI_RATE_LIMITED"),
        (500, "AI_UNAVAILABLE"),
        (401, "AI_UNAVAILABLE"),
        (404, "AI_UNAVAILABLE"),
        (307, "AI_UNAVAILABLE"),
    ],
)
def test_provider_failures_are_typed_private_and_not_retried(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    failure: Exception | int,
    code: str,
) -> None:
    calls = 0

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if isinstance(failure, Exception):
            raise failure
        return httpx.Response(
            failure,
            text="private-provider-body",
            headers={"Location": "https://never-follow.example"},
        )

    client, factory = runtime_client(monkeypatch, handle)
    response = post(client)
    assert response.status_code == 503
    assert response.json["error"]["code"] == code
    assert calls == 1
    assert factory.active == factory.closed
    assert "private-provider-body" not in response.text + caplog.text


@pytest.mark.parametrize(
    "body",
    [
        b"not-json",
        b"x" * 65537,
        json.dumps(model_response("")).encode(),
        json.dumps(model_response(done=False)).encode(),
        json.dumps(model_response(done_reason="length")).encode(),
        json.dumps(
            model_response(message={"role": "user", "content": "override"})
        ).encode(),
        json.dumps(
            model_response(
                message={
                    "role": "assistant",
                    "tool_calls": [
                        {"function": {"name": "get_team_context", "arguments": "{}"}}
                    ],
                }
            )
        ).encode(),
    ],
)
def test_malformed_or_truncated_model_reply_is_not_published(
    monkeypatch: pytest.MonkeyPatch, body: bytes
) -> None:
    client, factory = runtime_client(
        monkeypatch, lambda request: httpx.Response(200, content=body)
    )
    response = post(client)
    assert response.status_code == 503
    assert response.json["error"]["code"] == "AI_INVALID_RESPONSE"
    assert not factory.session.calls
    assert factory.active == factory.closed


@pytest.mark.parametrize(
    ("turn_timeout", "model_timeout"), [(0.05, 0.005), (0.005, 0.05)]
)
def test_model_and_total_deadline_cancel_io_and_close_resources(
    monkeypatch: pytest.MonkeyPatch, turn_timeout: float, model_timeout: float
) -> None:
    cancelled: list[bool] = []

    async def slow(request: httpx.Request) -> httpx.Response:
        try:
            await asyncio.sleep(1)
            return httpx.Response(200, json=model_response())
        finally:
            cancelled.append(True)

    client, factory = runtime_client(
        monkeypatch, slow, turn_timeout=turn_timeout, model_timeout=model_timeout
    )
    response = post(client)
    assert response.json["error"]["code"] == "AI_TIMEOUT"
    assert cancelled == [True]
    assert not factory.session.calls
    assert factory.active == factory.closed


def test_mcp_timeout_stops_runtime_without_further_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int] = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json=tool_message())

    client, factory = runtime_client(monkeypatch, handle)
    factory.session.failure = TimeoutError("private-tool-body")
    response = post(client)
    assert response.status_code == 503
    assert response.json["error"]["code"] == "MCP_TIMEOUT"
    assert len(calls) == 1
    assert factory.active == factory.closed


def test_oversized_tool_batch_has_no_partial_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = tool_message()
    body["message"]["tool_calls"] *= 7
    client, factory = runtime_client(
        monkeypatch, lambda request: httpx.Response(200, json=body)
    )
    response = post(client)
    assert response.json["error"]["code"] == "AGENT_LIMIT_REACHED"
    assert factory.session.calls == []


def test_runtime_keeps_output_guards_and_omits_private_trace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = model_response("private-draft [invented]")
    client, _ = runtime_client(
        monkeypatch, lambda request: httpx.Response(200, json=body)
    )
    response = post(client)
    assert response.status_code == 200
    assert "private-draft" not in response.text and "invented" not in response.text
    assert set(response.json["reply"]) == {"text", "references"}


def test_enabled_runner_requires_model_and_health_makes_no_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AI_AGENT_ENABLED", "true")
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)
    monkeypatch.setenv("AI_SERVICE_TOKEN", "service-secret")
    monkeypatch.setenv("MCP_URL", "http://127.0.0.1:8080/mcp")
    app = create_app()
    client = app.test_client()
    assert client.get("/health/ready").status_code == 503
    assert post(client).json["error"]["code"] == "NOT_READY"
    monkeypatch.setenv("OLLAMA_MODEL", "qwen3:4b-q4_K_M")
    monkeypatch.setenv("AI_MODEL_TIMEOUT", "12")
    assert create_app().test_client().get("/health/ready").status_code == 200
    assert Settings.from_env().model_timeout == 12


@pytest.mark.parametrize(
    "url",
    ["https://example.org", "http://localhost/path", "http://localhost/?key=secret"],
)
def test_llm_address_is_fixed_local_configuration(url: str) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        settings(ollama_url=url)


def test_flask_runner_with_real_sdk_mcp_protocol(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ai_buddy.mcp_client import Session
    from ai_buddy.schemas import TurnRequest
    from experiments.mcp_fixture import fixture_gateway

    @asynccontextmanager
    async def factory(request: TurnRequest) -> AsyncIterator[Session]:
        async with fixture_gateway("mentor") as gateway:
            yield gateway.session

    replies = iter([tool_message(), model_response("Анна Тестова [guide]")])
    monkeypatch.setattr(
        httpx,
        "AsyncHTTPTransport",
        lambda **kwargs: httpx.MockTransport(
            lambda request: httpx.Response(200, json=next(replies))
        ),
    )
    client = create_app(
        settings(agent_enabled=True, ollama_model="qwen3:4b-q4_K_M"),
        session_factory=factory,
    ).test_client()
    response = post(client)
    assert response.status_code == 200
    assert (
        response.json["reply"]["references"][0]["url"] == "https://demo.example/guide"
    )
    assert "Анна Тестова" in response.json["reply"]["text"]


def test_large_provider_input_is_rejected_without_sending_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int] = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json=model_response())

    client, factory = runtime_client(monkeypatch, handle)
    response = post(client, history=[{"role": "user", "content": "x" * 3150}] * 20)
    assert response.json["error"]["code"] == "INVALID_REQUEST"
    assert not calls
    assert factory.active == factory.closed


def test_deepseek_recovers_skipped_tools_and_repairs_citation(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from pydantic import SecretStr

    from tests.test_deepseek import response as deepseek_response

    sent: list[dict[str, Any]] = []
    replies = iter(
        [
            "Твой наставник — Анна Тестова, @demo_mentor.",
            "Твой наставник — Анна Тестова, @demo_mentor [guide].",
        ]
    )

    def handle(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json=deepseek_response(next(replies)))

    client, factory = runtime_client(
        monkeypatch,
        handle,
        llm_provider="deepseek",
        deepseek_api_key=SecretStr("private-key"),
    )
    with caplog.at_level("INFO"):
        answer = post(
            client,
            message="Кто мой наставник?",
            history=[{"role": "assistant", "content": "Ранее не знал."}],
        )
    assert answer.status_code == 200
    assert "Анна Тестова" in answer.json["reply"]["text"]
    assert answer.json["reply"]["references"]
    assert len(sent) == 2
    assert [call[0] for call in factory.session.calls] == ["get_team_context"]
    assert "Анна Тестова" in json.dumps(sent[1], ensure_ascii=False)
    assert "Ранее не знал" in json.dumps(sent[0], ensure_ascii=False)
    assert "Анна Тестова" not in caplog.text
    assert "private-key" not in caplog.text
    assert "tools=get_team_context" in caplog.text


def test_recovery_tool_failure_keeps_domain_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, factory = runtime_client(
        monkeypatch,
        lambda r: httpx.Response(200, json=model_response("Нет информации.")),
    )
    factory.session.failure = TimeoutError("private-mcp-body")
    response = post(client)
    assert response.status_code == 503
    assert response.json["error"]["code"] == "MCP_TIMEOUT"
    assert factory.active == factory.closed


@pytest.mark.parametrize("with_task", [False, True])
@pytest.mark.parametrize(
    ("message", "reply"),
    [
        ("салам алейкум", "Ва алейкум ассалам!"),
        ("ты тут?", "Да, я тут. Чем помочь?"),
        ("Чем можешь помочь?", "Помогу разобраться с задачами и инструментами."),
    ],
)
def test_deepseek_greeting_skips_knowledge_search_and_returns_no_sources(
    monkeypatch: pytest.MonkeyPatch,
    with_task: bool,
    message: str,
    reply: str,
) -> None:
    from pydantic import SecretStr

    from tests.test_deepseek import response as deepseek_response

    sent: list[dict[str, Any]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json=deepseek_response(reply))

    client, factory = runtime_client(
        monkeypatch,
        handle,
        llm_provider="deepseek",
        deepseek_api_key=SecretStr("private-key"),
    )
    extra = (
        {
            "page_context": {
                "url": "https://buddy.example/onboarding",
                "selection": {
                    "text": "Команда",
                    "title": "Пункт",
                    "resource": {"kind": "task", "id": "meet-team", "label": "Команда"},
                },
            }
        }
        if with_task
        else {}
    )
    answer = post(
        client,
        message=message,
        history=[
            {
                "role": "assistant",
                "content": "В доступных источниках нет информации. Уточни у наставника.",
            }
        ],
        **extra,
    )
    assert answer.status_code == 200
    assert answer.json["reply"] == {"text": reply, "references": []}
    assert len(sent) == 1
    assert not sent[0].get("tools")
    assert not factory.session.calls
    assert factory.active == factory.closed
