"""Team Jira questions read boards, independently of previous access requests."""

import asyncio
import json
from typing import Any

import httpx
import pytest
from mcp import types
from pydantic import SecretStr

from ai_buddy import create_app
from ai_buddy.agent import (
    Trace,
    access_topic,
    direct_loop,
    finalize,
    jira_list_scope,
    recover_context_reads,
)
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import Gateway
from ai_buddy.schemas import HistoryMessage
from tests.helpers import FakeFactory, FakeSession, context, result, settings
from tests.test_deepseek import response as deepseek_response
from tests.test_jira_recovery import jira_data
from tests.test_runtime import post

CORRECTION = (
    "я спрашиваю какие у нашей команды есть задачи на Jira, "
    "а ты говоришь что не можешь их посмотреть"
)
ACCESS_HISTORY = [
    HistoryMessage(role="user", content="Оформи доступ к Jira"),
    HistoryMessage(
        role="assistant",
        content="В каталоге доступов только доска delivery-team, списка задач я не вижу.",
    ),
]


class BoardSession(FakeSession):
    def __init__(
        self, *, boards: int = 1, board_error: bool = False, has_more: bool = False
    ) -> None:
        super().__init__()
        self.boards = boards
        self.board_error = board_error
        self.has_more = has_more

    async def call_tool(
        self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
    ) -> types.CallToolResult:
        self.calls.append((name, arguments, meta))
        assert name == "get_service_context"
        assert arguments["service"] == "jira"
        data = jira_data()
        data["has_more"] = self.has_more
        if arguments.get("board_id") is not None:
            if self.failure is not None:
                raise self.failure
            assert arguments["board_id"] in {
                f"delivery-{i}" for i in range(self.boards)
            }
            if self.board_error:
                return result(
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
            # The team task belongs to a colleague, not to the current user.
            data["issues"][0]["assignee_id"] = "colleague"
            data["boards"] = [data["boards"][0] | {"id": arguments["board_id"]}]
        else:
            data["issues"] = []
            data["boards"] = [
                data["boards"][0] | {"id": f"delivery-{i}"} for i in range(self.boards)
            ]
        return result({"ok": True, "data": data})


@pytest.mark.parametrize(
    ("question", "scope"),
    [
        (CORRECTION, "team"),
        ("Покажи доступные задачи в Jira", "team"),
        ("Какие задачи на доске Jira?", "team"),
        ("Список моих задач в Jira", "mine"),
        ("Покажи назначенные мне задачи Jira", "mine"),
        ("Какие у меня задачи в Jira?", "mine"),
        ("Какие задачи назначены мне в Jira?", "mine"),
        ("Какие задачи моей команды в Jira?", "team"),
        ("Оформи доступ к доске Jira", None),
        ("Создай задачу Jira", None),
        ("Переведи задачу DEL-1 в статус Готово", None),
        ("Как изменить статус задачи Jira?", None),
        ("Статус задачи DEL-1?", None),
        ("Кто мой наставник?", None),
    ],
)
def test_jira_list_scope(question: str, scope: str | None) -> None:
    assert jira_list_scope(question) == scope
    if scope is not None:
        assert not access_topic(question, ACCESS_HISTORY)


@pytest.mark.parametrize("question", [CORRECTION, "Покажи доступные задачи в Jira"])
def test_team_question_reads_colleagues_tasks_after_access_history(
    question: str,
) -> None:
    async def run() -> None:
        session = BoardSession()
        gateway = Gateway(session, context(message=question), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            assert not tools  # A list question cannot prepare actions or reread access.
            assert messages[-1]["content"] == question
            fresh = messages[-2]["content"]
            assert '"assignee_id": "colleague"' in fresh
            assert '"incomplete": false' in fresh
            return {
                "role": "assistant",
                "content": "DEL-1 — Первая задача, к выполнению. [jira:delivery]",
            }

        trace.raw_answer = await direct_loop(
            gateway,
            question,
            chat,
            trace,
            history=ACCESS_HISTORY,
            recover_context=True,
        )
        finalize(trace)
        assert trace.answer_status == "accepted"
        assert "DEL-1" in trace.answer
        assert [
            {key: value for key, value in arguments.items() if value is not None}
            for _, arguments, _ in session.calls
        ] == [
            {"service": "jira"},
            {"service": "jira", "board_id": "delivery-0"},
        ]
        assert set(trace.sources) == {"jira:delivery"}

    asyncio.run(run())


def test_flask_deepseek_wire_receives_team_tasks_and_returns_jira_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert not body.get("tools")
        assert '"assignee_id": "colleague"' in body["messages"][-2]["content"]
        assert "delegated-secret" not in request.content.decode()
        return httpx.Response(
            200, json=deepseek_response("DEL-1 — Первая задача. [jira:delivery]")
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
        session_factory=FakeFactory(BoardSession()),
    ).test_client()
    answer = post(
        client,
        message=CORRECTION,
        history=[message.model_dump() for message in ACCESS_HISTORY],
    )
    assert answer.status_code == 200
    assert answer.json["reply"] == {
        "text": "DEL-1 — Первая задача.",
        "references": [{"title": "Задачи Jira", "url": "https://jira.example/"}],
    }


def test_initial_forbidden_does_not_attempt_board_reads() -> None:
    async def run() -> None:
        session = FakeSession()
        session.failure = ServiceError(ErrorCode.FORBIDDEN)
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        readings = await recover_context_reads(
            gateway, "Задачи команды в Jira", Trace(raise_tool_errors=True)
        )
        assert len(session.calls) == 1
        assert readings[0]["result"]["error"] == "FORBIDDEN"

    asyncio.run(run())


def test_board_transport_failure_is_not_reported_as_empty_tasks() -> None:
    async def run() -> None:
        session = BoardSession()
        session.failure = ServiceError(ErrorCode.MCP_TIMEOUT)
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        with pytest.raises(ServiceError) as failure:
            await recover_context_reads(
                gateway, "Задачи команды в Jira", Trace(raise_tool_errors=True)
            )
        assert failure.value.code == ErrorCode.MCP_TIMEOUT
        assert len(session.calls) == 2

    asyncio.run(run())


@pytest.mark.parametrize(
    ("question", "boards", "budget", "error", "has_more", "calls", "incomplete"),
    [
        ("Мои задачи в Jira", 1, 6, False, False, 1, None),
        ("Задачи команды в Jira", 0, 6, False, False, 1, False),
        ("Задачи команды в Jira", 2, 6, False, False, 3, False),
        ("Задачи команды в Jira", 8, 6, False, False, 6, True),
        ("Задачи команды в Jira", 2, 1, False, False, 1, True),
        ("Задачи команды в Jira", 1, 6, True, False, 2, True),
        ("Задачи команды в Jira", 1, 6, False, True, 2, True),
    ],
)
def test_list_scope_limits_and_errors(
    question: str,
    boards: int,
    budget: int,
    error: bool,
    has_more: bool,
    calls: int,
    incomplete: bool | None,
) -> None:
    async def run() -> None:
        session = BoardSession(boards=boards, board_error=error, has_more=has_more)
        gateway = Gateway(session, context(), settings(max_tool_calls=budget))
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)
        readings = await recover_context_reads(gateway, question, trace)
        assert len(session.calls) == calls
        if incomplete is None:
            assert not any("jira_board_scope" in item for item in readings)
        else:
            assert readings[-1]["jira_board_scope"]["incomplete"] is incomplete
        if error:
            assert readings[1]["result"]["error"] == "FORBIDDEN"
            assert "private details" not in json.dumps(readings)

    asyncio.run(run())
