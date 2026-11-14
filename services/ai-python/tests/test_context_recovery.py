import asyncio
import json
from typing import Any

import pytest

from ai_buddy.agent import (
    Trace,
    conversational_only,
    direct_loop,
    finalize,
    recover_context_reads,
)
from ai_buddy.answer_policy import QUARANTINED, UNVERIFIED
from ai_buddy.mcp_client import Gateway
from experiments.mcp_fixture import payload
from tests.helpers import FakeSession, context, result, settings
from tests.test_runtime import RuntimeSession


@pytest.mark.parametrize(
    "question", ["Привет!", "Здравствуйте", "Спасибо большое.", "hello", "до свидания"]
)
def test_conversational_messages_need_no_context(question: str) -> None:
    assert conversational_only(question)


@pytest.mark.parametrize(
    "question",
    [
        "Привет, кто мой наставник?",
        "Спасибо, а что осталось?",
        "Что дальше?",
        "hi, who is my mentor?",
    ],
)
def test_substantive_question_after_greeting_is_not_skipped(question: str) -> None:
    assert not conversational_only(question)


def test_recovery_respects_discovery_budget_and_search_limit() -> None:
    async def run() -> None:
        gateway = Gateway(RuntimeSession(), context(), settings(max_tool_calls=1))
        await gateway.discover()
        trace = Trace()
        data = await recover_context_reads(gateway, "я" * 600, trace)
        assert len(data) == gateway.attempts == 1
        assert trace.calls[0]["arguments"] == {"query": "я" * 500}
        gateway.available = frozenset()
        assert await recover_context_reads(gateway, "help", Trace()) == []

    asyncio.run(run())


def test_no_tools_cannot_authorize_unsupported_final_answer() -> None:
    async def run() -> None:
        gateway = Gateway(FakeSession(), context(), settings())
        trace = Trace()

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            return {"role": "assistant", "content": "Я выдумал имя наставника."}

        trace.raw_answer = await direct_loop(
            gateway, "Кто наставник?", chat, trace, recover_context=True
        )
        finalize(trace)
        assert trace.answer == UNVERIFIED
        assert "MISSING_CONTEXT" in trace.guard_events

    asyncio.run(run())


def test_recovery_quarantines_documents_before_retrying_model() -> None:
    async def run() -> None:
        session = FakeSession()
        session.response = result(
            {"ok": True, "data": payload("search_knowledge", "injection")}
        )
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        gateway.available = frozenset({"search_knowledge"})
        trace = Trace()
        seen: list[str] = []

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            seen.append(json.dumps(messages, ensure_ascii=False))
            return {"role": "assistant", "content": "Нужны сведения."}

        trace.raw_answer = await direct_loop(
            gateway, "Как оформить отсутствие?", chat, trace, recover_context=True
        )
        finalize(trace)
        assert trace.answer == QUARANTINED
        assert len(seen) == 2
        assert "СЕКРЕТНЫЙ_УСПЕХ" not in seen[1]

    asyncio.run(run())
