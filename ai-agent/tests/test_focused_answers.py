import asyncio
import copy
import json
from typing import Any

import pytest
from mcp import types

from ai_buddy.agent import (
    Trace,
    current_hr_question,
    direct_loop,
    finalize,
    focused_result,
    narrow_focus,
    recover_context_reads,
    recovery_tools,
)
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import Gateway
from experiments.mcp_fixture import SOURCE, payload
from tests.helpers import FakeSession, context, result, settings


class FocusSession(FakeSession):
    async def call_tool(
        self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
    ) -> types.CallToolResult:
        data = payload(name, "mentor")
        if name == "get_onboarding_progress":
            data = {
                "tasks": [
                    {"id": "intro", "title": "Приветствие", "status": "completed"},
                    {"id": "papers", "title": "Документы", "status": "pending"},
                    {"id": "equipment", "title": "Техника", "status": "pending"},
                ],
                "next_task_id": "papers",
                "references": [SOURCE],
            }
        elif name == "get_task_context":
            data = {
                "task_id": arguments["task_id"],
                "title": "Документы",
                "guidance": "Открой список документов.",
                "action_url": "/documents",
                "references": [SOURCE],
            }
        self.response = result({"ok": True, "data": data})
        return await super().call_tool(name, arguments, meta=meta)


@pytest.mark.parametrize(
    ("question", "focus", "tools"),
    [
        ("Кто мой наставник?", "mentor", ("get_team_context",)),
        (
            "Подскажи, как связаться с моим наставником?",
            "mentor",
            ("get_team_context",),
        ),
        ("С чего начать сегодня?", "start", ("get_onboarding_progress",)),
        ("Какая у меня следующая задача?", "start", ("get_onboarding_progress",)),
        ("Как оформить отпуск?", "general", ("search_knowledge",)),
        ("Как наставник одобряет задание?", "general", ("search_knowledge",)),
        (
            "Кто мой наставник и что осталось по адаптации?",
            "general",
            ("get_team_context", "get_onboarding_progress"),
        ),
        (
            "Как запросить доступ?",
            "general",
            ("get_access_catalog", "search_knowledge"),
        ),
        ("Статус моих заявок на доступ?", "general", ("get_access_requests",)),
        ("Мои заявки на отпуск?", "general", ("search_knowledge",)),
    ],
)
def test_recovery_selects_question_context(
    question: str, focus: str, tools: tuple[str, ...]
) -> None:
    assert narrow_focus(question) == focus
    assert recovery_tools(question) == tools
    assert "submit_access_request" not in tools


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("Кто мой наставник?", False),
        ("С чего начать сегодня?", False),
        ("Как оформить отпуск?", False),
        ("Как оформить отпуск сегодня?", False),
        ("Есть ли у меня отпуск сегодня?", True),
        ("Что у меня сегодня по командировкам?", True),
        ("Есть ли у меня командировка завтра?", False),
    ],
)
def test_hr_today_is_not_extra_context_for_instructions(
    question: str, expected: bool
) -> None:
    assert current_hr_question(question) is expected


def test_mentor_generation_sees_only_requested_contact() -> None:
    async def run() -> None:
        gateway = Gateway(FocusSession(), context(), settings())
        await gateway.discover()
        trace = Trace()

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            assert tools == []
            assert "private-hr-marker" not in json.dumps(messages)
            content = messages[-2]["content"]
            data = json.loads(content.split(". Результаты: ")[1])[0]["result"]["data"]
            assert set(data) == {"mentor", "references"}
            assert messages[-1]["content"] == "Кто мой наставник?"
            return {
                "role": "assistant",
                "content": "Твой наставник — Анна Тестова, @demo_mentor [guide].",
            }

        trace.raw_answer = await direct_loop(
            gateway,
            "Кто мой наставник?",
            chat,
            trace,
            recover_context=True,
            hr_today="private-hr-marker",
        )
        finalize(trace)
        assert trace.answer_status == "accepted"
        assert "team" in trace.calls[0]["result"]["data"]
        assert list(trace.sources) == ["guide"]

    asyncio.run(run())


def test_start_recovery_uses_one_next_task_and_its_guidance() -> None:
    async def run() -> None:
        gateway = Gateway(FocusSession(), context(), settings())
        await gateway.discover()
        trace = Trace()
        reads = await recover_context_reads(gateway, "С чего начать сегодня?", trace)
        assert [read["tool"] for read in reads] == [
            "get_onboarding_progress",
            "get_task_context",
        ]
        assert [task["id"] for task in reads[0]["result"]["data"]["tasks"]] == [
            "papers"
        ]
        assert reads[1]["result"]["data"]["guidance"] == "Открой список документов."
        assert len(trace.calls[0]["result"]["data"]["tasks"]) == 3
        gateway = Gateway(FocusSession(), context(), settings(max_tool_calls=1))
        await gateway.discover()
        assert (
            len(await recover_context_reads(gateway, "С чего начать сегодня?", Trace()))
            == 1
        )

    asyncio.run(run())


def test_projection_preserves_general_question_errors_and_null_mentor() -> None:
    data = {
        "ok": True,
        "data": {"mentor": None, "team": "team", "references": [SOURCE]},
    }
    original = copy.deepcopy(data)
    assert (
        json.loads(
            focused_result("get_team_context", json.dumps(data), "Кто мой наставник?")
        )["data"]["mentor"]
        is None
    )
    assert data == original
    assert (
        json.loads(
            focused_result("get_team_context", json.dumps(data), "Расскажи о команде")
        )
        == original
    )
    failure = '{"ok": false, "error": "MCP_TIMEOUT"}'
    assert focused_result("get_team_context", failure, "Кто мой наставник?") == failure


def test_out_of_scope_model_tool_is_not_executed() -> None:
    async def run() -> None:
        session = FocusSession()
        gateway = Gateway(session, context(), settings())
        await gateway.discover()

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            return {
                "role": "assistant",
                "tool_calls": [
                    {"function": {"name": "get_onboarding_progress", "arguments": {}}}
                ],
            }

        with pytest.raises(ServiceError) as caught:
            await direct_loop(
                gateway, "Кто мой наставник?", chat, Trace(), recover_context=True
            )
        assert caught.value.code == ErrorCode.INVALID_TOOL
        assert [call[0] for call in session.calls] == ["get_team_context"]

    asyncio.run(run())
