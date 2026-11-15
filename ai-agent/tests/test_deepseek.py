import asyncio
import json
from typing import Any

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from ai_buddy.config import Settings
from ai_buddy.deepseek import deepseek_session, parse_response, wire_messages
from ai_buddy.errors import ErrorCode, ServiceError
from tests.test_runtime import post, runtime_client


def response(content: str = "Нужно уточнение.", **updates: Any) -> dict[str, Any]:
    choice = {
        "finish_reason": "stop",
        "message": {"role": "assistant", "content": content},
    }
    choice.update(updates)
    return {"choices": [choice]}


def test_flask_deepseek_calls_tools_and_preserves_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = []

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        assert request.headers["authorization"] == "Bearer cloud-key"
        assert request.url.path == "/chat/completions"
        assert "delegated-secret" not in request.content.decode()
        if len(seen) == 1:
            return httpx.Response(
                200,
                json=response(
                    finish_reason="tool_calls",
                    message={
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "provider-call-1",
                                "type": "function",
                                "function": {
                                    "name": "get_team_context",
                                    "arguments": "{}",
                                },
                            }
                        ],
                    },
                ),
            )
        messages = body["messages"]
        assistant = next(m for m in messages if m.get("tool_calls"))
        assert (
            messages[-1]["tool_call_id"]
            == assistant["tool_calls"][0]["id"]
            == "provider-call-1"
        )
        assert "tool_name" not in messages[-1]
        return httpx.Response(200, json=response("Анна Тестова @demo_mentor [guide]"))

    client, factory = runtime_client(
        monkeypatch,
        handle,
        llm_provider="deepseek",
        deepseek_api_key=SecretStr("cloud-key"),
    )
    result = post(client)
    assert result.status_code == 200
    assert result.json["reply"]["references"]
    assert len(factory.session.calls) == 1
    assert len(seen) == 2


@pytest.mark.parametrize(
    "status,body,code",
    [
        (401, {}, ErrorCode.AI_UNAVAILABLE),
        (429, {}, ErrorCode.AI_RATE_LIMITED),
        (500, {}, ErrorCode.AI_UNAVAILABLE),
        (302, {}, ErrorCode.AI_UNAVAILABLE),
        (200, {}, ErrorCode.AI_INVALID_RESPONSE),
        (200, response(""), ErrorCode.AI_INVALID_RESPONSE),
        (200, response(finish_reason="length"), ErrorCode.AI_INVALID_RESPONSE),
        (
            200,
            response(message={"role": "user", "content": "bad"}),
            ErrorCode.AI_INVALID_RESPONSE,
        ),
    ],
)
def test_provider_errors(
    monkeypatch: pytest.MonkeyPatch, status: int, body: dict[str, Any], code: ErrorCode
) -> None:
    client, _ = runtime_client(
        monkeypatch,
        lambda _: httpx.Response(status, json=body),
        llm_provider="deepseek",
        deepseek_api_key=SecretStr("cloud-key"),
    )
    result = post(client)
    assert result.status_code == 503
    assert result.json["error"]["code"] == code.value
    assert "cloud-key" not in result.text


def test_json_assessment_and_transport_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=response('{"ok":true}'))

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **_: httpx.MockTransport(handle)
    )
    cfg = Settings(llm_provider="deepseek", deepseek_api_key=SecretStr("key"))

    async def run() -> None:
        async with deepseek_session(
            cfg, response_schema={"type": "object"}, max_output_tokens=768
        ) as chat:
            assert (await chat([{"role": "user", "content": "test"}], []))[
                "content"
            ] == '{"ok":true}'
        assert requests[0]["response_format"] == {"type": "json_object"}
        assert requests[0]["max_tokens"] == 768
        assert "tools" not in requests[0]
        for error, expected in [
            (httpx.ReadTimeout("secret"), ErrorCode.AI_TIMEOUT),
            (httpx.ConnectError("secret"), ErrorCode.AI_UNAVAILABLE),
        ]:

            def fail(
                _: httpx.Request, failure: httpx.HTTPError = error
            ) -> httpx.Response:
                raise failure

            monkeypatch.setattr(
                httpx, "AsyncHTTPTransport", lambda **_: httpx.MockTransport(fail)
            )
            with pytest.raises(ServiceError) as caught:
                async with deepseek_session(cfg) as chat:
                    await chat([{"role": "user", "content": "test"}], [])
            assert caught.value.code == expected
        with pytest.raises(ServiceError) as caught:
            async with deepseek_session(Settings()) as chat:
                pass
        assert caught.value.code == ErrorCode.NOT_READY

    asyncio.run(run())


def test_provider_settings_and_invalid_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "private")
    cfg = Settings.from_env()
    assert cfg.model_configured and cfg.model_name == "deepseek-flash"
    assert "private" not in repr(cfg)
    for url in (
        "http://api.deepseek.com",
        "https://user@api.deepseek.com",
        "https://api.deepseek.com?key=private",
    ):
        with pytest.raises(ValidationError):
            Settings(deepseek_base_url=url)
    with pytest.raises(ValueError):
        wire_messages([{"role": "tool", "content": "orphan"}])
    with pytest.raises(ValueError):
        parse_response(
            response(
                finish_reason="tool_calls",
                message={
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": "x",
                            "type": "function",
                            "function": {"name": "get_team_context", "arguments": "[]"},
                        }
                    ],
                },
            )
        )
