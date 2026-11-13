"""Explicit local-demo MCP service. Go HTTP backend is not implemented here."""

import asyncio
import hmac
import json
import os
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.types import Receive, Scope, Send

from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import CONTRACTS, MAX_RESULT_BYTES
from ai_buddy.schemas import SearchEnvelope, TeamEnvelope

SUBJECT: ContextVar[str] = ContextVar("mcp_demo_subject")
CORPUS = Path(__file__).with_name("demo_corpus.json")


class Backend(Protocol):
    async def read(
        self, subject: str, tool: str, arguments: dict[str, Any]
    ) -> dict[str, Any]: ...


def terms(text: str) -> set[str]:
    # Deliberately simple demo search, not semantic retrieval or a policy database.
    return {
        word[:5] for word in re.findall(r"[\w]+", text.casefold()) if len(word) >= 4
    }


class DemoBackend:
    def __init__(self, path: Path = CORPUS) -> None:
        self.data = json.loads(path.read_text())
        for profile in self.data["profiles"].values():
            TeamEnvelope.model_validate({"ok": True, "data": profile})
        for document in self.data["documents"]:
            if document["source"]["is_demo"] is not True:
                raise ValueError("demo corpus must be marked synthetic")
            SearchEnvelope.model_validate(
                {
                    "ok": True,
                    "data": {
                        "documents": [
                            {k: v for k, v in document.items() if k != "keywords"}
                        ]
                    },
                }
            )

    async def read(
        self, subject: str, tool: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        if subject not in self.data["profiles"]:
            raise ServiceError(ErrorCode.FORBIDDEN)
        if tool == "get_team_context":
            return {"ok": True, "data": self.data["profiles"][subject]}
        query = terms(arguments["query"])
        ranked = sorted(
            (
                (
                    4 * len(query & terms(d["source"]["title"] + " " + d["keywords"]))
                    + len(query & terms(d["excerpt"])),
                    i,
                    d,
                )
                for i, d in enumerate(self.data["documents"])
            ),
            key=lambda item: (-item[0], item[1]),
        )
        documents = [
            {k: v for k, v in d.items() if k != "keywords"}
            for score, _, d in ranked
            if score > 0
        ][: arguments["limit"]]
        return {"ok": True, "data": {"documents": documents}}


def failure(code: ErrorCode) -> types.CallToolResult:
    return types.CallToolResult(
        isError=True,
        content=[],
        structuredContent={
            "ok": False,
            "error": {
                "code": code.value,
                "message": "Инструмент не выполнил запрос.",
                "retryable": False,
            },
        },
    )


def create_mcp_app(
    backend: Backend, *, principals: dict[str, str], timeout: float = 4
) -> Starlette:
    if not principals or not 0 < timeout <= 4:
        raise ValueError("explicit principals and bounded timeout required")
    if any(
        not token or any(ord(c) < 33 or ord(c) > 126 for c in token) or not subject
        for token, subject in principals.items()
    ):
        raise ValueError("invalid demo credential")
    server = Server("ai-buddy-local-demo")

    @server.list_tools()  # type: ignore[no-untyped-call,untyped-decorator]
    async def list_tools() -> list[types.Tool]:
        return [
            types.Tool(name=n, inputSchema=c.arguments.model_json_schema())
            for n, c in CONTRACTS.items()
        ]

    @server.call_tool(validate_input=False)  # type: ignore[untyped-decorator]
    async def call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        contract = CONTRACTS.get(name)
        if contract is None:
            return failure(ErrorCode.INVALID_TOOL)
        try:
            args = contract.arguments.model_validate(arguments)
            meta = server.request_context.meta
            if (
                meta is not None
                and (meta.model_extra or {}).get("ai-buddy.example/request-id")
                is not None
            ):
                UUID(str((meta.model_extra or {})["ai-buddy.example/request-id"]))
        except (ValidationError, ValueError, TypeError):
            return failure(ErrorCode.INVALID_ARGUMENTS)
        try:
            async with asyncio.timeout(timeout):
                value = await backend.read(SUBJECT.get(), name, args.model_dump())
            if value.get("ok") is not True:
                raise ValueError("backend must raise safe ServiceError")
            value = contract.result.model_validate(value).model_dump()
            if (
                name == "search_knowledge"
                and len(value["data"]["documents"]) > args.model_dump()["limit"]
            ):
                raise ValueError("search limit exceeded")
            result = types.CallToolResult(content=[], structuredContent=value)
            if len(result.model_dump_json().encode()) > MAX_RESULT_BYTES:
                return failure(ErrorCode.RESULT_TOO_LARGE)
            return result
        except TimeoutError:
            return failure(ErrorCode.MCP_TIMEOUT)
        except ServiceError as error:
            return failure(error.code)
        except (ValidationError, ValueError, TypeError):
            return failure(ErrorCode.INVALID_RESULT)
        except Exception:  # noqa: BLE001 -- backend text is never sent to SDK logs/model
            return failure(ErrorCode.TOOL_ERROR)

    manager = StreamableHTTPSessionManager(
        server,
        stateless=True,
        json_response=True,
        max_request_body_size=65536,
        security_settings=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=["127.0.0.1", "localhost", "127.0.0.1:*", "localhost:*"],
            allowed_origins=[
                "http://127.0.0.1",
                "http://localhost",
                "http://127.0.0.1:*",
                "http://localhost:*",
            ],
        ),
    )

    class Endpoint:
        async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
            request = Request(scope)
            headers = request.headers.getlist("authorization")
            supplied = headers[0] if len(headers) == 1 else ""
            subject = next(
                (
                    s
                    for token, s in principals.items()
                    if hmac.compare_digest(
                        supplied.encode(), ("Bearer " + token).encode()
                    )
                ),
                None,
            )
            if subject is None:
                await JSONResponse({"error": "UNAUTHORIZED"}, status_code=401)(
                    scope, receive, send
                )
                return
            handle = SUBJECT.set(subject)
            try:
                await manager.handle_request(scope, receive, send)
            finally:
                SUBJECT.reset(handle)

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        async with manager.run():
            yield

    async def health(request: Request) -> JSONResponse:
        return JSONResponse(
            {"status": "alive", "mode": "local_demo", "go_connected": False}
        )

    return Starlette(
        routes=[
            Route("/mcp", Endpoint(), methods=["GET", "POST", "DELETE"]),
            Route("/health/live", health),
        ],
        lifespan=lifespan,
    )


def create_demo_app() -> Starlette:
    if os.environ.get("MCP_DEMO_ENABLED", "false").lower() != "true":
        raise ValueError("MCP_DEMO_ENABLED=true is required")
    token = os.environ.get("MCP_DEMO_TOKEN", "")
    profile = os.environ.get("MCP_DEMO_PROFILE", "alex")
    backend = DemoBackend()
    if profile not in backend.data["profiles"]:
        raise ValueError("unknown demo profile")
    return create_mcp_app(backend, principals={token: profile})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        create_demo_app(),
        host="127.0.0.1",
        port=8002,
        access_log=False,
        log_level="warning",
    )
