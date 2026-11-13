import asyncio
import json
from collections.abc import Callable, Sequence
from typing import Any, Literal

import httpx
import pytest
from langchain_core.language_models import LanguageModelInput
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.runnables import Runnable
from langchain_core.tools import BaseTool
from langchain_core.utils.function_calling import convert_to_openai_tool
from mcp import types

from ai_buddy.mcp_client import Gateway, canonical_schema
from experiments.agent_loops import (
    OPTIONS,
    Trace,
    ollama_chat,
    ollama_model,
    run_loop,
    tool_schemas,
)
from experiments.compare import CASES, grade
from experiments.mcp_fixture import fixture_gateway, payload
from tests.helpers import FakeSession, context, result, settings


class ScriptedModel(FakeMessagesListChatModel):
    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | Callable[..., Any] | BaseTool],
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> Runnable[LanguageModelInput, AIMessage]:
        return self


def tool_call(name: str = "get_team_context", **arguments: Any) -> dict[str, Any]:
    return {
        "role": "assistant",
        "content": "",
        "tool_calls": [{"function": {"name": name, "arguments": arguments}}],
    }


def text(value: str = "Демо-ответ [guide]") -> dict[str, Any]:
    return {"role": "assistant", "content": value}


async def scripted(
    engine: Literal["direct", "langchain"],
    messages: list[dict[str, Any]],
    session: FakeSession,
    *,
    deadline: float = 1,
) -> Trace:
    iterator = iter(messages)

    async def chat(
        history: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> dict[str, Any]:
        # Only user text and MCP data go to the model, never trusted delegation.
        assert "delegated-secret" not in json.dumps(history)
        assert "request_id" not in json.dumps(history)
        return next(iterator)

    responses: list[BaseMessage] = [
        AIMessage(
            content=m["content"],
            tool_calls=[
                {
                    "name": c["function"]["name"],
                    "args": c["function"]["arguments"],
                    "id": f"call-{i}",
                }
                for i, c in enumerate(m.get("tool_calls", []))
            ],
        )
        for m in messages
    ]
    return await run_loop(
        engine,
        Gateway(session, context(), settings()),
        "Кто мой наставник?",
        chat=chat,
        model=ScriptedModel(responses=responses),
        deadline=deadline,
    )


@pytest.mark.parametrize("engine", ["direct", "langchain"])
def test_tool_result_and_final_answer(engine: Literal["direct", "langchain"]) -> None:
    session = FakeSession()
    session.response = result(
        {"ok": True, "data": payload("get_team_context", "mentor")}
    )
    trace = asyncio.run(scripted(engine, [tool_call(), text()], session))
    assert trace.answer == "Демо-ответ [guide]"
    assert trace.model_calls == 2
    assert trace.calls[0]["result"]["data"]["mentor"]["display_name"] == "Анна Тестова"
    assert trace.error is None
    assert session.calls[0][0] == "get_team_context"


@pytest.mark.parametrize("engine", ["direct", "langchain"])
@pytest.mark.parametrize(
    "failure", ["arguments", "unknown_tool", "forbidden", "timeout"]
)
def test_safe_tool_failure(
    engine: Literal["direct", "langchain"], failure: str
) -> None:
    session = FakeSession()
    call = tool_call()
    expected = {
        "arguments": "INVALID_ARGUMENTS",
        "unknown_tool": "INVALID_TOOL",
        "forbidden": "FORBIDDEN",
        "timeout": "MCP_TIMEOUT",
    }[failure]
    if failure == "arguments":
        call = tool_call(impersonate="another-user")
    elif failure == "unknown_tool":
        call = tool_call("approve_stage")
    elif failure == "forbidden":
        session.response = result(
            {
                "ok": False,
                "error": {
                    "code": "FORBIDDEN",
                    "message": "private details",
                    "retryable": False,
                },
            },
            error=True,
        )
    else:
        session.failure = TimeoutError("private details")
    trace = asyncio.run(scripted(engine, [call, text("Нет подтверждения")], session))
    assert trace.error is None
    assert trace.calls[0]["result"] == {"ok": False, "error": expected}
    assert "private details" not in json.dumps(trace.calls)
    if failure in {"arguments", "unknown_tool"}:
        assert not session.calls


@pytest.mark.parametrize("engine", ["direct", "langchain"])
def test_model_call_budget(engine: Literal["direct", "langchain"]) -> None:
    trace = asyncio.run(scripted(engine, [tool_call()] * 5, FakeSession()))
    assert trace.error == "AGENT_LIMIT_REACHED"
    assert trace.model_calls == 3
    assert len(trace.calls) == 3


@pytest.mark.parametrize("engine", ["direct", "langchain"])
def test_tool_attempt_budget(engine: Literal["direct", "langchain"]) -> None:
    message = tool_call("approve_stage")
    message["tool_calls"] *= 7
    trace = asyncio.run(scripted(engine, [message], FakeSession()))
    assert trace.error == "AGENT_LIMIT_REACHED"
    assert len(trace.calls) == 6


@pytest.mark.parametrize("engine", ["direct", "langchain"])
def test_deadline(engine: Literal["direct", "langchain"]) -> None:
    class SlowSession(FakeSession):
        async def list_tools(self, cursor: str | None = None) -> types.ListToolsResult:
            await asyncio.sleep(0.05)
            return self.pages

    trace = asyncio.run(scripted(engine, [text()], SlowSession(), deadline=0.001))
    assert trace.error == "DEADLINE"


@pytest.mark.parametrize("engine", ["direct", "langchain"])
def test_invalid_model_output(engine: Literal["direct", "langchain"]) -> None:
    trace = asyncio.run(scripted(engine, [text("")], FakeSession()))
    assert trace.error == "MODEL_ERROR"


def test_ollama_payload_and_adapter_options(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[dict[str, Any]] = []

    def handle(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={"message": text("ok")})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    assert asyncio.run(ollama_chat([], []))["content"] == "ok"
    assert captured[0]["options"] == OPTIONS
    assert captured[0]["think"] is False
    model = ollama_model()
    assert model.reasoning is False
    for key, value in OPTIONS.items():
        assert getattr(model, key) == value
    tools = tool_schemas(frozenset({"search_knowledge", "get_team_context"}))
    assert all(
        canonical_schema(convert_to_openai_tool(t)) == canonical_schema(t)
        for t in tools
    )


def test_real_mcp_fixture() -> None:
    async def run() -> None:
        for case in ("mentor", "unknown", "injection"):
            async with fixture_gateway(case) as gateway:
                await gateway.discover()
                assert (await gateway.call("get_team_context", {}))["mentor"][
                    "display_name"
                ] == "Анна Тестова"
                data = await gateway.call("search_knowledge", {"query": "test"})
                assert bool(data["documents"]) == (case != "unknown")

    asyncio.run(run())


def test_evaluation_does_not_accept_failure_or_injected_answer() -> None:
    case = CASES[-1]
    assert not all(grade(case, Trace(answer="СЕКРЕТНЫЙ_УСПЕХ")).values())
    assert not all(grade(CASES[0], Trace(error="DEADLINE")).values())


def test_concurrent_tools_reserve_budget_before_await() -> None:
    class SlowSession(FakeSession):
        async def call_tool(
            self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
        ) -> types.CallToolResult:
            await asyncio.sleep(0)
            return await super().call_tool(name, arguments, meta=meta)

    async def run() -> None:
        session = SlowSession()
        session.response = result(
            {"ok": True, "data": payload("get_team_context", "mentor")}
        )
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace()
        results = await asyncio.gather(
            *(trace.execute(gateway, "get_team_context", {}) for _ in range(7)),
            return_exceptions=True,
        )
        assert len(trace.calls) == 6
        assert len(session.calls) == 6
        assert sum(isinstance(item, Exception) for item in results) == 1
        assert all(c["result"]["ok"] for c in trace.calls)

    asyncio.run(run())
