"""Access clarification keeps the live catalog and prepares a manual confirmation."""

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from mcp import types
from pydantic import ValidationError

from ai_buddy.agent import Trace, access_topic, direct_loop, finalize, recovery_tools
from ai_buddy.mcp_client import Gateway
from ai_buddy.mcp_server import create_mcp_app
from ai_buddy.schemas import HistoryMessage
from ai_buddy.service_schemas import PrepareServiceActionArguments
from tests.helpers import FakeSession, context, result, settings
from tests.test_go_http import GoMock, backend, sdk, turn
from tests.test_remaining_services import draft_data

ACTION: dict[str, Any] = {
    "operation": "request_access",
    "template_id": "bi",
    "catalog_version": 1,
    "system": "BI",
    "resource_key": "delivery-bi",
    "justification": "Проверить воронку оформления доставки",
    "permission": "read",
    "duration_days": 30,
    "fields": {"workspace": "Путь заказа"},
}


def catalog_data() -> dict[str, Any]:
    catalog = json.loads(
        (
            Path(__file__).parents[2] / "web/backend/internal/portal/catalog.json"
        ).read_text()
    )
    template = next(t for t in catalog["templates"] if t["id"] == "bi")
    template["resources"] = [{"resource_key": "delivery-bi", "fields": {}}]
    return {
        "version": 1,
        "templates": [template],
        "context": {
            "profile_id": "olga",
            "product_id": "delivery",
            "job_role": "analyst",
            "name": "Ольга",
            "team_name": "Путь заказа",
            "can_review": False,
        },
        "references": [
            {
                "id": "access-catalog",
                "title": "Каталог доступов",
                "url": "https://access.example/",
                "version": "v1",
                "is_demo": True,
            }
        ],
    }


def access_draft() -> dict[str, Any]:
    data = draft_data()
    data["draft"].update(
        service="access",
        operation="request_access",
        title="Заявка на доступ к BI",
        service_url="https://access.example/?tab=requests",
    )
    return data


@pytest.mark.parametrize("operation", ["request_access"])
def test_access_action_contract(operation: str) -> None:
    assert (
        PrepareServiceActionArguments.model_validate(
            {"action": ACTION}
        ).action.operation
        == operation
    )
    for change in (
        {"profile_id": "sasha"},
        {"duration_days": 0},
        {"permission": "owner"},
        {"catalog_version": 2},
        {"fields": {"workspace": ""}},
    ):
        with pytest.raises(ValidationError):
            PrepareServiceActionArguments.model_validate({"action": ACTION | change})


@pytest.mark.parametrize(
    "question",
    [
        "Чтение, 30 дней, пространство Путь заказа",
        "Да, срок 30 дней",
        "BI, delivery-bi, чтение",
    ],
)
def test_access_parameter_replies_keep_catalog_topic(question: str) -> None:
    history = [
        HistoryMessage(role="user", content="Оформи доступ к BI"),
        HistoryMessage(role="assistant", content="Укажи срок и рабочее пространство"),
    ]
    assert access_topic(question, history)
    assert not access_topic("Кто мой наставник?", history)
    assert not access_topic("Спасибо", history)
    assert not access_topic("Отмени заявку", history)
    assert not access_topic("Создай задачу Jira", history)
    assert not access_topic("Какие бенефиты доступны?", [])


@pytest.mark.parametrize("service", ["BI", "DWH", "Jira", "VPN", "репозиторию"])
def test_access_requests_read_catalog_instead_of_service_context(service: str) -> None:
    assert recovery_tools("Оформи доступ к " + service) == ("get_access_catalog",)


def test_clarification_reads_fresh_bi_catalog_and_prepares_without_direct_submission() -> (
    None
):
    async def run() -> None:
        class Session(FakeSession):
            async def call_tool(
                self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
            ) -> types.CallToolResult:
                self.calls.append((name, arguments, meta))
                if name == "get_access_catalog":
                    return result({"ok": True, "data": catalog_data()})
                assert name == "prepare_service_action"
                assert arguments == {"action": ACTION}
                return result({"ok": True, "data": access_draft()})

        session = Session()
        request = context(
            message="Чтение, 30 дней, Путь заказа. Обоснование: проверить воронку оформления доставки"
        )
        gateway = Gateway(session, request, settings())
        await gateway.discover()
        history = [
            HistoryMessage(role="user", content="Оформи доступ к BI"),
            HistoryMessage(
                role="assistant", content="Укажи срок и рабочее пространство"
            ),
        ]

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            assert session.calls[0][0] == "get_access_catalog"
            assert any(
                '"resource_key": "delivery-bi"' in message.get("content", "")
                for message in messages
            )
            assert messages[-1]["content"] == request.message
            return {
                "role": "assistant",
                "tool_calls": [
                    {
                        "function": {
                            "name": "prepare_service_action",
                            "arguments": {"action": ACTION},
                        }
                    }
                ],
            }

        trace = Trace(raise_tool_errors=True)
        trace.raw_answer = await direct_loop(
            gateway, request.message, chat, trace, history=history, recover_context=True
        )
        finalize(trace)
        assert trace.answer_status == "accepted"
        assert "Подтвердить" in trace.answer
        assert [call[0] for call in session.calls] == [
            "get_access_catalog",
            "prepare_service_action",
        ]
        assert trace.model_calls == 1

    asyncio.run(run())


def test_access_action_survives_gateway_sdk_and_go_http() -> None:
    async def run() -> None:
        mock = GoMock()

        def response(req: httpx.Request) -> httpx.Response:
            assert req.url.path == "/internal/v1/ai/service-actions/prepare"
            assert json.loads(req.content) == {"action": ACTION}
            return httpx.Response(200, json={"ok": True, "data": access_draft()})

        mock.read_response = response
        adapter = backend(mock)
        app = create_mcp_app(adapter, authenticator=adapter, mode="go_http")
        req = turn()
        async with app.router.lifespan_context(app), sdk(app, req) as session:
            gateway = Gateway(session, req, settings())
            await gateway.discover()
            data = await gateway.call("prepare_service_action", {"action": ACTION})
            assert data["draft"]["service"] == "access"
            assert data["draft"]["state"] == "prepared"
        assert len(mock.reads) == 1

    asyncio.run(run())
