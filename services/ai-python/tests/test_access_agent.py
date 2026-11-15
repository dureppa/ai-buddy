import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from ai_buddy.agent import Trace, access_receipt, direct_loop, finalize
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.go_http import GoHTTPBackend, GoHTTPSettings
from ai_buddy.mcp_client import Gateway
from ai_buddy.mcp_identity import PRINCIPAL, Principal
from ai_buddy.runner import present_answer
from ai_buddy.schemas import AccessArguments, AccessSubmitEnvelope
from tests.helpers import FakeSession, context, result, settings

ARGS: dict[str, Any] = {
    "template_id": "dwh",
    "catalog_version": 1,
    "system": "DWH",
    "resource_key": "delivery.orders_mart",
    "justification": "Исследовать воронку оформления заказа",
    "permission": "read",
    "duration_days": 30,
    "fields": {"usage": "Исследование"},
}
RECEIPT: dict[str, Any] = {
    "request": {
        "id": "6ec29497-e40a-4c3e-a4d3-716095a94f61",
        "number": "ДОС-000001",
        "status": "submitted",
        "system": "DWH",
        "resource_key": "delivery.orders_mart",
        "permission": "read",
        "duration_days": 30,
    },
    "references": [
        {
            "id": "access:6ec29497-e40a-4c3e-a4d3-716095a94f61",
            "title": "ДОС-000001",
            "url": "http://localhost:5190/?request=6ec29497-e40a-4c3e-a4d3-716095a94f61",
            "version": "v1",
            "is_demo": True,
        }
    ],
}


def test_access_schemas_reject_identity_forgery_missing_fields_and_empty_receipt() -> (
    None
):
    assert AccessArguments.model_validate(ARGS).duration_days == 30
    for updates in (
        {"profile_id": "maria"},
        {"status": "granted"},
        {"permission": "owner"},
        {"duration_days": 0},
        {"duration_days": 91},
        {"justification": "short"},
        {"catalog_version": 2},
    ):
        with pytest.raises(ValidationError):
            AccessArguments.model_validate({**ARGS, **updates})
    incomplete = dict(ARGS)
    del incomplete["fields"]
    with pytest.raises(ValidationError):
        AccessArguments.model_validate(incomplete)
    with pytest.raises(ValidationError):
        AccessSubmitEnvelope.model_validate(
            {"ok": True, "data": {**RECEIPT, "references": []}}
        )


def test_submit_returns_persisted_receipt_without_an_extra_model_generation() -> None:
    async def run() -> None:
        session = FakeSession()
        session.response = result({"ok": True, "data": RECEIPT})
        gateway = Gateway(session, context(message="Оформи доступ к DWH"), settings())
        await gateway.discover()
        calls = 0

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            nonlocal calls
            calls += 1
            assert calls == 1
            tool = next(
                item
                for item in tools
                if item["function"]["name"] == "submit_access_request"
            )
            assert "profile_id" not in tool["function"]["parameters"]["properties"]
            return {
                "role": "assistant",
                "tool_calls": [
                    {"function": {"name": "submit_access_request", "arguments": ARGS}}
                ],
            }

        trace = Trace(raise_tool_errors=True)
        trace.raw_answer = await direct_loop(
            gateway, "Оформи доступ к DWH", chat, trace
        )
        finalize(trace)
        assert trace.answer_status == "accepted"
        assert "ДОС-000001" in trace.answer and "не выдача доступа" in trace.answer
        assert len(session.calls) == 1
        assert trace.model_calls == 1
        assert "отправлено" in trace.answer
        presented = present_answer(trace)
        assert "ДОС-000001" in presented and "не выдача доступа" in presented
        assert "[access:" not in presented
        assert RECEIPT["references"][0]["id"] in trace.sources

    asyncio.run(run())


def test_business_refusal_can_be_explained_without_claiming_success() -> None:
    async def run() -> None:
        session = FakeSession()
        session.response = result(
            {
                "ok": False,
                "error": {
                    "code": "FORBIDDEN",
                    "message": "blocked",
                    "retryable": False,
                },
            },
            error=True,
        )
        gateway = Gateway(session, context(), settings())
        await gateway.discover()
        trace = Trace(raise_tool_errors=True)
        reply = json.loads(await trace.execute(gateway, "submit_access_request", ARGS))
        assert reply == {"ok": False, "error": "FORBIDDEN"}
        assert not trace.sources
        assert access_receipt(json.dumps(reply)) is None
        gateway.available = frozenset({"get_access_catalog"})
        with pytest.raises(ServiceError) as error:
            await gateway.call("submit_access_request", ARGS)
        assert error.value.code == ErrorCode.INVALID_TOOL
        assert len(session.calls) == 1

    asyncio.run(run())


def test_go_http_submission_uses_scoped_resource_token_and_explicit_route() -> None:
    async def run() -> None:
        request_id = uuid4()
        observed: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            observed.append(request)
            assert request.method == "POST"
            assert request.url.path == "/internal/v1/ai/access/requests"
            assert request.headers["Authorization"] == "Bearer resource-token"
            assert request.headers["X-Request-ID"] == str(request_id)
            assert json.loads(request.content) == ARGS
            return httpx.Response(200, json={"ok": True, "data": RECEIPT})

        backend = GoHTTPBackend(
            GoHTTPSettings(
                url="http://127.0.0.1:8080", service_token=SecretStr("adapter-token")
            ),
            transport=httpx.MockTransport(handler),
        )
        principal = Principal(
            subject="olga",
            allowed_tools=frozenset({"submit_access_request"}),
            request_id=request_id,
            expires_at=datetime.now(UTC) + timedelta(minutes=1),
            api_token=SecretStr("resource-token"),
        )
        handle = PRINCIPAL.set(principal)
        try:
            value = await backend.read("olga", "submit_access_request", ARGS)
            assert value["data"]["request"]["number"] == "ДОС-000001"
            with pytest.raises(ServiceError):
                await backend.read("maria", "submit_access_request", ARGS)
            assert len(observed) == 1
        finally:
            PRINCIPAL.reset(handle)

    asyncio.run(run())
