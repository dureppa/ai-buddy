"""Calendar requests must use actual personal events and confirmation drafts."""

import asyncio
from typing import Any

import pytest
from mcp import types
from pydantic import ValidationError

from ai_buddy.agent import (
    Trace,
    calendar_arguments,
    direct_loop,
    finalize,
    recovery_tools,
    service_topic,
)
from ai_buddy.mcp_client import Gateway
from ai_buddy.schemas import HistoryMessage
from ai_buddy.service_schemas import (
    PrepareServiceActionArguments,
    ServiceContextArguments,
)
from tests.helpers import FakeSession, context, result, settings
from tests.test_remaining_services import draft_data


def calendar_data() -> dict[str, Any]:
    return {
        "service": "calendar",
        "today": "2026-11-16",
        "timezone": "Europe/Moscow",
        "start_date": "2026-11-16",
        "end_date": "2026-11-22",
        "has_more": False,
        "events": [
            {
                "id": "one",
                "title": "Кофе с наставником",
                "kind": "Встреча",
                "startsAt": "2026-11-17T08:00:00Z",
                "tone": "mint",
                "description": "Знакомство",
            }
        ],
        "references": [
            {
                "id": "calendar:own",
                "title": "Календарь событий",
                "url": "/events",
                "version": "live-v1",
                "is_demo": True,
            }
        ],
    }


class CalendarSession(FakeSession):
    async def call_tool(
        self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
    ) -> types.CallToolResult:
        self.calls.append((name, arguments, meta))
        if name == "get_service_context":
            assert arguments["service"] == "calendar"
            return result({"ok": True, "data": calendar_data()})
        assert name == "prepare_service_action"
        data = draft_data()
        data["draft"].update(
            service="calendar", operation="create_calendar_event", service_url="/events"
        )
        return result({"ok": True, "data": data})


@pytest.mark.parametrize(
    ("question", "period"),
    [
        ("какие события у меня на этой неделе?", "week"),
        ("События на следующей неделе", "next_week"),
        ("Что в календаре завтра?", "tomorrow"),
        ("Какие встречи сегодня?", "today"),
        ("Расписание на месяц", "month"),
        ("Создай встречу с лидом завтра в 15:00", "tomorrow"),
    ],
)
def test_calendar_routing(question: str, period: str) -> None:
    assert service_topic(question) == "calendar"
    assert recovery_tools(question) == ("get_service_context",)
    assert calendar_arguments(question) == {"service": "calendar", "period": period}


def test_explicit_dates_and_invalid_scopes() -> None:
    args = calendar_arguments("События с 2026-11-15 по 2026-11-20")
    assert args == {
        "service": "calendar",
        "start_date": "2026-11-15",
        "end_date": "2026-11-20",
    }
    ServiceContextArguments.model_validate(args)
    for invalid in (
        {"service": "jira", "period": "week"},
        {"service": "calendar", "board_id": "delivery"},
        {"service": "calendar", "start_date": "2026-11-15"},
        {
            "service": "calendar",
            "period": "week",
            "start_date": "2026-11-15",
            "end_date": "2026-11-20",
        },
        {"service": "calendar", "profile_id": "sasha"},
    ):
        with pytest.raises(ValidationError):
            ServiceContextArguments.model_validate(invalid)


@pytest.mark.parametrize(
    "starts", ["2030-01-01T12:00:00+03:00", "2030-01-01T09:00:00Z"]
)
def test_create_calendar_event_contract(starts: str) -> None:
    args = PrepareServiceActionArguments.model_validate(
        {
            "action": {
                "operation": "create_calendar_event",
                "title": "Встреча",
                "starts_at": starts,
            }
        }
    )
    assert args.action.kind == "Встреча"  # type: ignore[union-attr]
    for bad in ("2030-01-01T12:00:00", "2030-02-30T12:00:00+03:00", "not a time"):
        with pytest.raises(ValidationError):
            PrepareServiceActionArguments.model_validate(
                {
                    "action": {
                        "operation": "create_calendar_event",
                        "title": "Встреча",
                        "starts_at": bad,
                    }
                }
            )


def test_weekly_read_overrides_old_no_calendar_answer() -> None:
    async def run() -> None:
        session = CalendarSession()
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            fresh = messages[-2]["content"]
            assert "Кофе с наставником" in fresh and "Europe/Moscow" in fresh
            assert len(session.calls) == 1 and session.calls[0][1]["period"] == "week"
            return {
                "role": "assistant",
                "content": "17 ноября в 11:00 — кофе с наставником. [calendar:own]",
            }

        trace.raw_answer = await direct_loop(
            gateway,
            "какие события у меня на этой неделе?",
            chat,
            trace,
            recover_context=True,
            history=[
                HistoryMessage(
                    role="assistant",
                    content="Календаря нет в источниках, спроси наставника.",
                )
            ],
        )
        finalize(trace)
        assert trace.answer_status == "accepted" and trace.sources == {
            "calendar:own": "/events"
        }

    asyncio.run(run())


def test_creation_prepares_only_and_reads_calendar_first() -> None:
    async def run() -> None:
        session = CalendarSession()
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            assert "2026-11-16" in messages[-2]["content"]
            return {
                "role": "assistant",
                "tool_calls": [
                    {
                        "function": {
                            "name": "prepare_service_action",
                            "arguments": {
                                "action": {
                                    "operation": "create_calendar_event",
                                    "title": "Разбор задачи",
                                    "kind": "Созвон",
                                    "starts_at": "2026-11-17T15:00:00+03:00",
                                }
                            },
                        }
                    }
                ],
            }

        trace.raw_answer = await direct_loop(
            gateway,
            "Создай созвон Разбор задачи завтра в 15:00",
            chat,
            trace,
            recover_context=True,
        )
        finalize(trace)
        assert trace.answer_status == "accepted" and "Подтвердить" in trace.answer
        assert [name for name, _, _ in session.calls] == [
            "get_service_context",
            "prepare_service_action",
        ]
        assert all(name != "confirm" for name, _, _ in session.calls)

    asyncio.run(run())
