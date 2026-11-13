import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from mcp import ClientSession, types
from mcp.client.streamable_http import streamable_http_client
from pydantic import BaseModel, ValidationError

from ai_buddy.config import Settings
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.schemas import (
    EmptyArguments,
    FailureEnvelope,
    SearchArguments,
    SearchEnvelope,
    TeamEnvelope,
    TurnRequest,
)

MAX_RESULT_BYTES = 32 * 1024
MAX_TRANSPORT_BYTES = 1024 * 1024


class Session(Protocol):
    async def list_tools(self, cursor: str | None) -> types.ListToolsResult: ...
    async def call_tool(
        self, name: str, arguments: dict[str, Any], *, meta: dict[str, Any]
    ) -> types.CallToolResult: ...


@dataclass(frozen=True)
class Contract:
    arguments: type[BaseModel]
    result: type[BaseModel]


CONTRACTS = {
    "search_knowledge": Contract(SearchArguments, SearchEnvelope),
    "get_team_context": Contract(EmptyArguments, TeamEnvelope),
}


def canonical_schema(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: canonical_schema(v)
            for k, v in value.items()
            if k not in {"title", "description", "$comment"}
        }
    if isinstance(value, list):
        return [canonical_schema(v) for v in value]
    return value


class Gateway:
    def __init__(
        self, session: Session, context: TurnRequest, settings: Settings
    ) -> None:
        self.session = session
        self.context = context
        self.settings = settings
        self.available: frozenset[str] = frozenset()
        self.attempts = 0

    async def discover(self) -> frozenset[str]:
        names: set[str] = set()
        seen: set[str] = set()
        cursor = None
        try:
            async with asyncio.timeout(self.settings.tool_timeout):
                for _ in range(4):
                    page = await self.session.list_tools(cursor)
                    for tool in page.tools:
                        if tool.name in names:
                            raise ServiceError(ErrorCode.INCOMPATIBLE_SCHEMA)
                        contract = CONTRACTS.get(tool.name)
                        if contract is not None:
                            if canonical_schema(tool.inputSchema) != canonical_schema(
                                contract.arguments.model_json_schema()
                            ):
                                raise ServiceError(ErrorCode.INCOMPATIBLE_SCHEMA)
                            names.add(tool.name)
                    cursor = page.nextCursor
                    if cursor is None:
                        self.available = frozenset(names)
                        return self.available
                    if cursor in seen:
                        raise ServiceError(ErrorCode.AGENT_LIMIT_REACHED)
                    seen.add(cursor)
            raise ServiceError(ErrorCode.AGENT_LIMIT_REACHED)
        except ServiceError:
            raise
        except Exception as error:  # noqa: BLE001 -- sanitize discovery/transport failures
            raise classified_error(error) from None

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in self.available:
            raise ServiceError(ErrorCode.INVALID_TOOL)
        contract = CONTRACTS[name]
        try:
            validated = contract.arguments.model_validate(arguments)
        except ValidationError:
            raise ServiceError(ErrorCode.INVALID_ARGUMENTS) from None
        if self.attempts >= self.settings.max_tool_calls:
            raise ServiceError(ErrorCode.AGENT_LIMIT_REACHED)
        self.attempts += 1
        try:
            async with asyncio.timeout(self.settings.tool_timeout):
                result = await self.session.call_tool(
                    name,
                    validated.model_dump(),
                    meta={"ai-buddy.example/request-id": str(self.context.request_id)},
                )
        except TimeoutError:
            raise ServiceError(ErrorCode.MCP_TIMEOUT) from None
        except ServiceError:
            raise
        except Exception:  # noqa: BLE001 -- sanitize untrusted transport errors
            raise ServiceError(ErrorCode.MCP_UNAVAILABLE) from None
        try:
            serialized = result.model_dump_json(by_alias=True)
            if len(serialized.encode("utf-8")) > MAX_RESULT_BYTES:
                raise ServiceError(ErrorCode.RESULT_TOO_LARGE)
            data = result.structuredContent
            if data is None or type(data.get("ok")) is not bool:
                raise ValueError("missing structured result")
            # Text JSON is a duplicate representation, never a second source of truth.
            for block in result.content:
                if (
                    not isinstance(block, types.TextContent)
                    or json.loads(block.text) != data
                ):
                    raise ValueError("inconsistent result")
            json.dumps(data, allow_nan=False)
            if result.isError:
                failure = FailureEnvelope.model_validate(data)
                safe_codes = {
                    "FORBIDDEN": ErrorCode.FORBIDDEN,
                    "NOT_FOUND": ErrorCode.NOT_FOUND,
                    "CONTEXT_EXPIRED": ErrorCode.CONTEXT_EXPIRED,
                    "TEMPORARILY_UNAVAILABLE": ErrorCode.TEMPORARILY_UNAVAILABLE,
                    "INVALID_ARGUMENTS": ErrorCode.INVALID_ARGUMENTS,
                }
                raise ServiceError(
                    safe_codes.get(failure.error.code, ErrorCode.TOOL_ERROR)
                )
            parsed = contract.result.model_validate(data)
            payload: dict[str, Any] = parsed.model_dump()["data"]
            if (
                name == "search_knowledge"
                and len(payload["documents"]) > validated.model_dump()["limit"]
            ):
                raise ValueError("limit exceeded")
            return payload
        except (ValueError, TypeError, ValidationError):
            raise ServiceError(ErrorCode.INVALID_RESULT) from None


class LimitedStream(httpx.AsyncByteStream):
    def __init__(self, inner: httpx.AsyncByteStream) -> None:
        self.inner = inner

    async def __aiter__(self) -> AsyncIterator[bytes]:
        size = 0
        async for chunk in self.inner:
            size += len(chunk)
            if size > MAX_TRANSPORT_BYTES:
                raise ServiceError(ErrorCode.RESULT_TOO_LARGE)
            yield chunk

    async def aclose(self) -> None:
        await self.inner.aclose()


class LimitedTransport(httpx.AsyncBaseTransport):
    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self.inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self.inner.handle_async_request(request)
        # SDK implements its own redirect policy. Reject before it can replay credentials.
        if 300 <= response.status_code < 400:
            await response.aclose()
            raise ServiceError(ErrorCode.MCP_UNAVAILABLE)
        if not isinstance(response.stream, httpx.AsyncByteStream):
            response.close()
            raise ServiceError(ErrorCode.MCP_UNAVAILABLE)
        response.stream = LimitedStream(response.stream)
        return response

    async def aclose(self) -> None:
        await self.inner.aclose()


def classified_error(error: Exception) -> ServiceError:
    if isinstance(error, ServiceError):
        return error
    if isinstance(error, TimeoutError):
        return ServiceError(ErrorCode.MCP_TIMEOUT)
    if isinstance(error, ExceptionGroup):
        for nested in error.exceptions:
            if isinstance(nested, Exception):
                classified = classified_error(nested)
                if classified.code != ErrorCode.MCP_UNAVAILABLE:
                    return classified
    return ServiceError(ErrorCode.MCP_UNAVAILABLE)


@asynccontextmanager
async def sdk_session(
    settings: Settings, context: TurnRequest
) -> AsyncIterator[Session]:
    if settings.mcp_url is None:
        raise ServiceError(ErrorCode.NOT_READY)
    try:
        async with (
            httpx.AsyncClient(
                headers={
                    "Authorization": "Bearer "
                    + context.delegation_token.get_secret_value()
                },
                transport=LimitedTransport(httpx.AsyncHTTPTransport(retries=0)),
                timeout=httpx.Timeout(settings.tool_timeout),
                trust_env=False,
                follow_redirects=False,
            ) as client,
            streamable_http_client(settings.mcp_url, http_client=client) as (
                read,
                write,
                _,
            ),
            ClientSession(read, write) as session,
        ):
            async with asyncio.timeout(settings.tool_timeout):
                await session.initialize()
            yield session
    except Exception as error:  # noqa: BLE001 -- SDK may raise nested task-group errors
        raise classified_error(error) from None
