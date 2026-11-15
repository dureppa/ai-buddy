"""Human Jira keys and recoverable model mistakes must not break the chat turn."""

import asyncio
import json
from typing import Any

import pytest
from mcp import types

from ai_buddy.agent import (
    Trace,
    direct_loop,
    finalize,
    focused_result,
    recovery_tools,
    service_topic,
)
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import Gateway
from tests.helpers import FakeSession, context, result, settings
from tests.test_remaining_services import ISSUE, draft_data

QUESTION = "Переведи задачу DEL-1 в статус “Готово”"
ACTION = {
    "action": {
        "operation": "update_jira_issue",
        "issue_id": ISSUE,
        "version": 3,
        "changes": {"status": "done"},
    }
}


def jira_data() -> dict[str, Any]:
    return {
        "service": "jira",
        "current_user_id": "olga",
        "spaces": [],
        "boards": [
            {"id": "delivery", "space_id": "delivery", "name": "Доставка", "key": "DEL"}
        ],
        "members": [],
        "has_more": False,
        "issues": [
            {
                "id": ISSUE,
                "key": "DEL-1",
                "board_id": "delivery",
                "space_id": "delivery",
                "title": "Первая задача",
                "description": "Проверить обработчик",
                "description_truncated": False,
                "status": "todo",
                "priority": "medium",
                "assignee_id": "olga",
                "reporter_id": "olga",
                "due_date": None,
                "version": 3,
            }
        ],
        "references": [
            {
                "id": "jira:delivery",
                "url": "https://jira.example/",
                "title": "Задачи Jira",
                "version": "live-v1",
                "is_demo": True,
            }
        ],
    }


class JiraSession(FakeSession):
    async def call_tool(
        self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
    ) -> types.CallToolResult:
        self.calls.append((name, arguments, meta))
        if name == "get_service_context":
            assert arguments["service"] == "jira"
            return result({"ok": True, "data": jira_data()})
        assert name == "prepare_service_action"
        assert arguments == ACTION
        return result({"ok": True, "data": draft_data()})


@pytest.mark.parametrize(
    "question",
    [QUESTION, "Статус задачи DELON-1?", "Измени задачу del-1", "Открой тикет DEL-1"],
)
def test_jira_key_routes_to_service_without_jira_name(question: str) -> None:
    assert service_topic(question) == "jira"
    assert recovery_tools(question) == ("get_service_context",)


@pytest.mark.parametrize(
    "question",
    [
        "Кто мой наставник?",
        "Как оформить отпуск?",
        "Объясни HTTP-500",
        "Расскажи про COVID-19",
    ],
)
def test_non_issue_text_does_not_route_to_jira(question: str) -> None:
    assert service_topic(question) != "jira"


@pytest.mark.parametrize("bad_tool", ["get_service_context", "prepare_service_action"])
def test_invalid_key_can_be_repaired_into_a_confirmable_draft(bad_tool: str) -> None:
    async def run() -> None:
        session = JiraSession()
        gateway = Gateway(session, context(message=QUESTION), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            if trace.model_calls == 1:
                assert messages[-1]["content"] == QUESTION
                fresh = messages[-2]["content"]
                assert "DEL-1" in fresh and ISSUE in fresh
                bad = (
                    {"service": "jira", "issue_id": "DEL-1"}
                    if bad_tool == "get_service_context"
                    else {"action": ACTION["action"] | {"issue_id": "DEL-1"}}
                )
                return {
                    "role": "assistant",
                    "tool_calls": [{"function": {"name": bad_tool, "arguments": bad}}],
                }
            failure = json.loads(messages[-1]["content"])
            assert failure["error"] == "INVALID_ARGUMENTS"
            assert "UUID" in failure["hint"]
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
            gateway, QUESTION, chat, trace, recover_context=True
        )
        finalize(trace)
        assert trace.answer_status == "accepted" and "Подтвердить" in trace.answer
        assert trace.model_calls == 2
        assert [name for name, _, _ in session.calls] == [
            "get_service_context",
            "prepare_service_action",
        ]
        assert len(trace.calls) == 3

    asyncio.run(run())


@pytest.mark.parametrize("name", ["get_service_context", "prepare_service_action"])
@pytest.mark.parametrize("code", ["NOT_FOUND", "FORBIDDEN"])
def test_domain_error_is_explained_without_http_failure(name: str, code: str) -> None:
    async def run() -> None:
        session = FakeSession()
        session.response = result(
            {
                "ok": False,
                "error": {
                    "code": code,
                    "message": "private service detail",
                    "retryable": False,
                },
            },
            error=True,
        )
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
                                "name": name,
                                "arguments": {"service": "jira"}
                                if name == "get_service_context"
                                else ACTION,
                            }
                        }
                    ],
                }
            assert json.loads(messages[-1]["content"])["error"] == code
            assert "private service detail" not in str(messages)
            return {
                "role": "assistant",
                "content": "Задача недоступна. Проверь её ключ или доступ к доске.",
            }

        trace.raw_answer = await direct_loop(gateway, QUESTION, chat, trace)
        finalize(trace)
        assert trace.answer_status == "accepted" and "недоступна" in trace.answer

    asyncio.run(run())


@pytest.mark.parametrize(
    "code",
    [
        ErrorCode.TEMPORARILY_UNAVAILABLE,
        ErrorCode.INVALID_RESULT,
        ErrorCode.CONTEXT_EXPIRED,
        ErrorCode.MCP_UNAVAILABLE,
    ],
)
def test_transport_and_integrity_errors_still_propagate(code: ErrorCode) -> None:
    async def run() -> None:
        session = FakeSession()
        session.failure = ServiceError(code)
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        with pytest.raises(ServiceError) as error:
            await Trace(raise_tool_errors=True).execute(
                gateway, "get_service_context", {"service": "jira"}
            )
        assert error.value.code == code

    asyncio.run(run())


@pytest.mark.parametrize("prefill", [False, True])
def test_repeated_bad_calls_end_with_a_short_clarification(prefill: bool) -> None:
    async def run() -> None:
        session = JiraSession()
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            return {
                "role": "assistant",
                "tool_calls": [
                    {
                        "function": {
                            "name": "get_service_context",
                            "arguments": {"service": "jira", "issue_id": "DEL-1"},
                        }
                    }
                ],
            }

        trace.raw_answer = await direct_loop(
            gateway, QUESTION, chat, trace, recover_context=prefill
        )
        finalize(trace)
        assert trace.answer_status == "accepted"
        assert trace.model_calls == 3 and len(trace.calls) <= 6
        assert "Не удалось" in trace.answer and len(trace.answer) < 350
        assert all(name != "prepare_service_action" for name, _, _ in session.calls)

    asyncio.run(run())


def test_key_focus_keeps_target_and_does_not_mutate_audit_data() -> None:
    data = jira_data()
    data["issues"].append(
        {**data["issues"][0], "key": "DEL-2", "title": "Unrelated issue"}
    )
    source = json.dumps({"ok": True, "data": data})
    focused = json.loads(focused_result("get_service_context", source, QUESTION))
    assert [issue["key"] for issue in focused["data"]["issues"]] == ["DEL-1"]
    assert len(data["issues"]) == 2
    assert focused["data"]["references"] == data["references"]
    assert json.loads(
        focused_result("get_service_context", source, "Мои задачи Jira")
    ) == json.loads(source)
    assert json.loads(
        focused_result("get_service_context", source, "Покажи задачу DEL-99")
    ) == json.loads(source)


@pytest.mark.parametrize("code", ["NOT_FOUND", "FORBIDDEN"])
@pytest.mark.parametrize("name", ["get_service_context", "prepare_service_action"])
def test_repeated_domain_failures_end_without_chat_failure(
    code: str, name: str
) -> None:
    async def run() -> None:
        session = FakeSession()
        session.response = result(
            {
                "ok": False,
                "error": {"code": code, "message": "private", "retryable": False},
            },
            error=True,
        )
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            return {
                "role": "assistant",
                "tool_calls": [
                    {
                        "function": {
                            "name": name,
                            "arguments": {"service": "jira"}
                            if name == "get_service_context"
                            else ACTION,
                        }
                    }
                ],
            }

        trace.raw_answer = await direct_loop(gateway, QUESTION, chat, trace)
        finalize(trace)
        assert trace.answer_status == "accepted"
        assert trace.model_calls == 3 and len(trace.calls) == 3
        assert "Не удалось" in trace.answer and "private" not in trace.answer

    asyncio.run(run())
