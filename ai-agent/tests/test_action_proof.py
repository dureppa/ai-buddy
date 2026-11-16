"""A valid calendar citation cannot prove that an action draft was prepared."""

import asyncio
import json
from typing import Any

import httpx
import pytest
from mcp import types
from pydantic import SecretStr

from ai_buddy import create_app
from ai_buddy.agent import (
    ACTION_UNCONFIRMED,
    Trace,
    action_request,
    action_state_claim,
    direct_loop,
    finalize,
)
from ai_buddy.mcp_client import Gateway
from ai_buddy.schemas import HistoryMessage
from tests.helpers import FakeFactory, context, result, settings
from tests.test_calendar import CalendarSession
from tests.test_deepseek import response as model_response
from tests.test_runtime import post

QUESTION = "Создай созвон Разбор задачи завтра в 15:00"
LIE = "Готово, черновик созвона «Разбор задачи» на 17.11.2026, 15:00 (Москва) подготовлен. Открой карточку и нажми «Подтвердить» — до этого события в календаре нет. [calendar:own]"
ACTION = {
    "action": {
        "operation": "create_calendar_event",
        "title": "Разбор задачи",
        "kind": "Созвон",
        "starts_at": "2026-11-17T15:00:00+03:00",
    }
}


@pytest.mark.parametrize(
    "text",
    [
        LIE,
        "Черновик подготовлен [calendar:own]",
        "Я создал событие [calendar:own]",
        "Готово!",
        "Вот карточка подтверждения",
        "Открой карточку и нажми Подтвердить",
        "Добавил созвон в календарь",
        "Встреча запланирована",
        "Статус задачи изменён",
        "Я перевёл задачу в Готово",
        "Черновик созвона «"
        + "Длинное название " * 12
        + "» на завтра в 15:00 подготовлен",
    ],
)
def test_unconfirmed_claim_variants(text: str) -> None:
    assert action_state_claim(text)


@pytest.mark.parametrize(
    "text",
    [
        "Черновик не подготовлен. Укажи время.",
        "Не удалось подготовить карточку.",
        "Когда черновик готов, открой карточку и нажми Подтвердить.",
        "После подготовки открой карточку.",
        "Я готов помочь. Как назвать встречу и когда она начнётся?",
        "Какое время указать?",
    ],
)
def test_clarifications_negations_and_instructions_are_not_success(text: str) -> None:
    assert not action_state_claim(text)


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        (QUESTION, True),
        ("Можешь создать встречу завтра?", True),
        ("Оформи доступ к BI", True),
        ("Переведи задачу DEL-1 в Готово", True),
        ("Как создать событие?", False),
        ("Расскажи, как отправить заявку", False),
        ("Какие события на этой неделе?", False),
    ],
)
def test_action_intent(question: str, expected: bool) -> None:
    assert action_request(question) is expected


def test_lie_is_repaired_into_a_real_preparation() -> None:
    async def run() -> None:
        session = CalendarSession()
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            if trace.model_calls == 1:
                return {"role": "assistant", "content": LIE}
            feedback = messages[-1]["content"]
            assert "не получил успешный результат prepare_service_action" in feedback
            assert "исправляй только цитату" in feedback
            return {
                "role": "assistant",
                "tool_calls": [
                    {
                        "function": {
                            "name": "prepare_service_action",
                            "arguments": ACTION,
                        }
                    }
                ],
            }

        trace.raw_answer = await direct_loop(
            gateway,
            QUESTION,
            chat,
            trace,
            recover_context=True,
            history=[HistoryMessage(role="assistant", content=LIE)],
        )
        finalize(trace)
        assert trace.answer_status == "accepted" and "Подтвердить" in trace.answer
        assert "UNCONFIRMED_ACTION" in trace.guard_events
        assert [name for name, _, _ in session.calls] == [
            "get_service_context",
            "prepare_service_action",
        ]
        assert "[action:" in trace.answer
        assert trace.model_calls == 2

    asyncio.run(run())


def test_persistent_lie_stops_with_honest_feedback_at_budget() -> None:
    async def run() -> None:
        session = CalendarSession()
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            return {"role": "assistant", "content": LIE}

        trace.raw_answer = await direct_loop(
            gateway, QUESTION, chat, trace, recover_context=True
        )
        finalize(trace)
        assert (
            trace.answer == ACTION_UNCONFIRMED
            and trace.answer_status == "safe_abstention"
        )
        assert trace.model_calls == 3 and len(session.calls) == 1
        assert "наставник" not in trace.answer

    asyncio.run(run())


def test_finalize_catches_a_claim_even_without_repair_loop() -> None:
    trace = Trace(
        action_requested=True, raw_answer=LIE, sources={"calendar:own": "/events"}
    )
    finalize(trace)
    assert (
        trace.answer == ACTION_UNCONFIRMED and trace.answer_status == "safe_abstention"
    )


def test_real_receipt_controls_state_and_requires_current_source() -> None:
    async def run() -> None:
        session = CalendarSession()
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(action_requested=True, raise_tool_errors=True)
        await trace.execute(gateway, "prepare_service_action", ACTION)
        trace.raw_answer = "Событие создано"
        finalize(trace)
        assert trace.answer_status == "accepted"
        assert "Действие подготовлено" in trace.answer
        assert "Событие создано" not in trace.answer
        trace.sources.clear()
        trace.raw_answer = LIE
        finalize(trace)
        assert trace.answer == ACTION_UNCONFIRMED
        assert trace.action_receipt() is None

    asyncio.run(run())


def test_unavailable_preparation_tool_does_not_lead_to_a_fake_card() -> None:
    async def run() -> None:
        session = CalendarSession()
        session.pages.tools = [
            tool
            for tool in session.pages.tools
            if tool.name != "prepare_service_action"
        ]
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            return {"role": "assistant", "content": LIE}

        trace.raw_answer = await direct_loop(
            gateway, QUESTION, chat, trace, recover_context=True
        )
        finalize(trace)
        assert trace.answer == ACTION_UNCONFIRMED
        assert trace.model_calls == 1

    asyncio.run(run())


def test_exhausted_tool_budget_returns_honest_feedback_without_an_extra_model_call() -> (
    None
):
    async def run() -> None:
        session = CalendarSession()
        gateway = Gateway(session, context(), settings(max_tool_calls=1))
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            return {"role": "assistant", "content": LIE}

        trace.raw_answer = await direct_loop(
            gateway, QUESTION, chat, trace, recover_context=True
        )
        finalize(trace)
        assert trace.answer == ACTION_UNCONFIRMED
        assert trace.model_calls == 1
        assert gateway.attempts == 1

    asyncio.run(run())


def test_missing_parameters_remain_a_question_without_preparation() -> None:
    async def run() -> None:
        session = CalendarSession()
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            return {
                "role": "assistant",
                "content": "Как назвать созвон и в какое время его поставить? [calendar:own]",
            }

        trace.raw_answer = await direct_loop(
            gateway, "Создай созвон", chat, trace, recover_context=True
        )
        finalize(trace)
        assert trace.answer_status == "accepted"
        assert "Как назвать" in trace.answer
        assert [name for name, _, _ in session.calls] == ["get_service_context"]
        assert "UNCONFIRMED_ACTION" not in trace.guard_events

    asyncio.run(run())


def test_tool_failure_cannot_prove_preparation() -> None:
    async def run() -> None:
        class FailedSession(CalendarSession):
            async def call_tool(
                self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
            ) -> types.CallToolResult:
                if name == "prepare_service_action":
                    self.calls.append((name, arguments, meta))
                    return result(
                        {
                            "ok": False,
                            "error": {
                                "code": "FORBIDDEN",
                                "message": "private detail",
                                "retryable": False,
                            },
                        },
                        error=True,
                    )
                return await super().call_tool(name, arguments, meta=meta)

        session = FailedSession()
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            if trace.model_calls == 1:
                return {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "function": {
                                "name": "prepare_service_action",
                                "arguments": ACTION,
                            }
                        }
                    ],
                }
            return {"role": "assistant", "content": LIE}

        trace.raw_answer = await direct_loop(
            gateway, QUESTION, chat, trace, recover_context=True
        )
        finalize(trace)
        assert trace.action_receipt() is None and trace.answer == ACTION_UNCONFIRMED

    asyncio.run(run())


def test_flask_reply_contains_action_link_after_recovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(200, json=model_response(LIE))
        return httpx.Response(
            200,
            json=model_response(
                finish_reason="tool_calls",
                message={
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "create-calendar",
                            "type": "function",
                            "function": {
                                "name": "prepare_service_action",
                                "arguments": json.dumps(ACTION),
                            },
                        }
                    ],
                },
            ),
        )

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.MockTransport(handle)
    )
    client = create_app(
        settings(
            agent_enabled=True,
            llm_provider="deepseek",
            deepseek_api_key=SecretStr("synthetic"),
        ),
        session_factory=FakeFactory(CalendarSession()),
    ).test_client()
    answer = post(client, message=QUESTION)
    assert answer.status_code == 200
    assert calls == 2
    assert any(
        source["url"].startswith("/actions/")
        for source in answer.json["reply"]["references"]
    )
    assert "Действие подготовлено" in answer.json["reply"]["text"]
