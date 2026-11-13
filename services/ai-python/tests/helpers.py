import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

from mcp import types
from pydantic import SecretStr

from ai_buddy.config import Settings
from ai_buddy.mcp_client import CONTRACTS, Gateway, Session
from ai_buddy.schemas import Reply, TurnRequest


def context(**updates: Any) -> TurnRequest:
    data: dict[str, Any] = {
        "request_id": str(uuid4()),
        "conversation_id": str(uuid4()),
        "message": "Что дальше?",
        "delegation_token": "delegated-secret",
    }
    data.update(updates)
    return TurnRequest.model_validate_json(json.dumps(data))


def settings(**updates: Any) -> Settings:
    return Settings(
        service_token=SecretStr("service-secret"),
        mcp_url="http://127.0.0.1:8080/mcp",
        **updates,
    )


def result(data: dict[str, Any], *, error: bool = False) -> types.CallToolResult:
    return types.CallToolResult(
        isError=error,
        structuredContent=data,
        content=[types.TextContent(type="text", text=json.dumps(data))],
    )


class FakeSession:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
        self.pages = types.ListToolsResult(
            tools=[
                types.Tool(name=name, inputSchema=c.arguments.model_json_schema())
                for name, c in CONTRACTS.items()
            ]
        )
        self.response = result({"ok": True, "data": {"documents": []}})
        self.failure: Exception | None = None

    async def list_tools(self, cursor: str | None = None) -> types.ListToolsResult:
        return self.pages

    async def call_tool(
        self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
    ) -> types.CallToolResult:
        self.calls.append((name, arguments, meta))
        if self.failure:
            raise self.failure
        return self.response


class FakeFactory:
    def __init__(self, session: FakeSession) -> None:
        self.session = session
        self.active: list[str] = []
        self.closed: list[str] = []

    @asynccontextmanager
    async def __call__(self, request: TurnRequest) -> AsyncIterator[Session]:
        token = request.delegation_token.get_secret_value()
        self.active.append(token)
        try:
            yield self.session
        finally:
            self.closed.append(token)


class ReadRunner:
    async def run(self, request: TurnRequest, gateway: Gateway) -> Reply:
        await gateway.call("search_knowledge", {"query": request.message})
        return Reply(text="Проверенный тестовый результат")


def request_json(request: TurnRequest) -> str:
    data = request.model_dump(mode="json")
    data["delegation_token"] = request.delegation_token.get_secret_value()
    return json.dumps(data)
