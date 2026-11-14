"""Bounded Go HTTP adapter with explicitly delegated request submission. No retries, implicit demo or token passthrough."""

import asyncio
import hmac
import json
import os
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator

from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import CONTRACTS, MAX_RESULT_BYTES
from ai_buddy.mcp_identity import PRINCIPAL, Principal
from ai_buddy.schemas import ClosedModel, FailureEnvelope, Identifier, safe_url

RESOLVE_BYTES = 16 * 1024
ERRORS = {
    400: ErrorCode.INVALID_ARGUMENTS,
    401: ErrorCode.CONTEXT_EXPIRED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    429: ErrorCode.TEMPORARILY_UNAVAILABLE,
    503: ErrorCode.TEMPORARILY_UNAVAILABLE,
}


def ascii_token(value: SecretStr) -> SecretStr:
    text = value.get_secret_value()
    if not 1 <= len(text) <= 8192 or any(not 33 <= ord(c) <= 126 for c in text):
        raise ValueError("invalid credential")
    return value


class GoHTTPSettings(ClosedModel):
    url: str
    service_token: SecretStr
    resolve_timeout: Annotated[float, Field(gt=0, le=1)] = 1.0
    read_timeout: Annotated[float, Field(gt=0, le=2.5)] = 2.5

    @field_validator("url")
    @classmethod
    def fixed_origin(cls, value: str) -> str:
        safe_url(value)
        parts = urlsplit(value)
        if (
            any(c.isspace() for c in value)
            or parts.path not in {"", "/"}
            or "?" in value
            or "#" in value
            or parts.username is not None
            or parts.password is not None
            or (parts.port is not None and not 1 <= parts.port <= 65535)
            or (
                parts.scheme == "http"
                and parts.hostname not in {"localhost", "127.0.0.1", "::1", "go"}
            )
        ):
            raise ValueError("Go API requires a fixed HTTPS origin or loopback HTTP")
        return value.rstrip("/")

    _token = field_validator("service_token")(ascii_token)

    @classmethod
    def from_env(cls) -> "GoHTTPSettings":
        return cls(
            url=os.environ.get("GO_API_URL", ""),
            service_token=SecretStr(os.environ.get("MCP_ADAPTER_SERVICE_TOKEN", "")),
        )


class ActiveContext(ClosedModel):
    active: Literal[True]
    subject_id: Identifier
    request_id: UUID
    conversation_id: UUID
    allowed_tools: Annotated[list[str], Field(max_length=9)]
    expires_at: datetime
    api_token: SecretStr

    _token = field_validator("api_token")(ascii_token)

    @model_validator(mode="after")
    def valid_context(self) -> "ActiveContext":
        if self.expires_at.utcoffset() != timedelta(0):
            raise ValueError("expiry must be UTC")
        if len(set(self.allowed_tools)) != len(self.allowed_tools) or any(
            tool not in CONTRACTS for tool in self.allowed_tools
        ):
            raise ValueError("invalid tool grants")
        return self


class InactiveContext(ClosedModel):
    active: Literal[False]


def closed_json(body: bytes) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def nonfinite(value: str) -> None:
        raise ValueError("nonfinite JSON value")

    return json.loads(body, object_pairs_hook=pairs, parse_constant=nonfinite)


class GoHTTPBackend:
    def __init__(
        self,
        settings: GoHTTPSettings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self.transport = transport

    async def request(
        self,
        method: str,
        path: str,
        *,
        token: SecretStr,
        timeout: float,
        max_bytes: int,
        payload: dict[str, Any] | None = None,
        request_id: UUID | None = None,
    ) -> tuple[int, bytes]:
        headers = {
            "Authorization": "Bearer " + token.get_secret_value(),
            "Accept": "application/json",
            "Accept-Encoding": "identity",
        }
        if request_id is not None:
            headers["X-Request-ID"] = str(request_id)
        try:
            async with (
                asyncio.timeout(timeout),
                httpx.AsyncClient(
                    transport=self.transport
                    or httpx.AsyncHTTPTransport(retries=0, trust_env=False),
                    timeout=httpx.Timeout(timeout),
                    trust_env=False,
                    follow_redirects=False,
                ) as client,
                client.stream(
                    method, self.settings.url + path, headers=headers, json=payload
                ) as response,
            ):
                if response.status_code not in {200, *ERRORS}:
                    raise ServiceError(ErrorCode.TOOL_ERROR)
                if (
                    response.headers.get("content-type", "").split(";")[0].lower()
                    != "application/json"
                    or response.headers.get("content-encoding", "identity")
                    != "identity"
                ):
                    raise ServiceError(ErrorCode.INVALID_RESULT)
                length = response.headers.get("content-length")
                if length is not None:
                    if not length.isascii() or not length.isdecimal():
                        raise ServiceError(ErrorCode.INVALID_RESULT)
                    if int(length) > max_bytes:
                        raise ServiceError(ErrorCode.RESULT_TOO_LARGE)
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(body) + len(chunk) > max_bytes:
                        raise ServiceError(ErrorCode.RESULT_TOO_LARGE)
                    body.extend(chunk)
                closed_json(bytes(body))
                return response.status_code, bytes(body)
        except ServiceError:
            raise
        except (TimeoutError, httpx.HTTPError):
            raise ServiceError(ErrorCode.TEMPORARILY_UNAVAILABLE) from None
        except (ValueError, TypeError, RecursionError):
            raise ServiceError(ErrorCode.INVALID_RESULT) from None

    async def authenticate(self, token: str) -> Principal:
        try:
            ascii_token(SecretStr(token))
        except ValueError:
            raise ServiceError(ErrorCode.UNAUTHORIZED) from None
        status, body = await self.request(
            "POST",
            "/internal/v1/ai/context/resolve",
            token=self.settings.service_token,
            timeout=self.settings.resolve_timeout,
            max_bytes=RESOLVE_BYTES,
            payload={"delegation_token": token},
        )
        if status != 200:
            raise ServiceError(ErrorCode.TOOL_ERROR)
        try:
            data = closed_json(body)
            if not isinstance(data, dict) or type(data.get("active")) is not bool:
                raise ValueError("invalid active flag")
            if data["active"] is False:
                InactiveContext.model_validate_json(body)
                raise ServiceError(ErrorCode.UNAUTHORIZED)
            value = ActiveContext.model_validate_json(body)
            if value.expires_at <= datetime.now(UTC):
                raise ServiceError(ErrorCode.UNAUTHORIZED)
            if any(
                hmac.compare_digest(value.api_token.get_secret_value(), other)
                for other in (token, self.settings.service_token.get_secret_value())
            ):
                raise ValueError("credentials must be separate")
            return Principal(
                subject=value.subject_id,
                allowed_tools=frozenset(value.allowed_tools),
                request_id=value.request_id,
                conversation_id=value.conversation_id,
                expires_at=value.expires_at,
                api_token=value.api_token,
            )
        except (ValueError, TypeError, ValidationError):
            raise ServiceError(ErrorCode.INVALID_RESULT) from None

    async def read(
        self, subject: str, tool: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        principal = PRINCIPAL.get()
        if principal.subject != subject or tool not in principal.allowed_tools:
            raise ServiceError(ErrorCode.FORBIDDEN)
        if principal.api_token is None or principal.expires_at is None:
            raise ServiceError(ErrorCode.CONTEXT_EXPIRED)
        remaining = (principal.expires_at - datetime.now(UTC)).total_seconds()
        if remaining <= 0:
            raise ServiceError(ErrorCode.CONTEXT_EXPIRED)
        contract = CONTRACTS[tool]
        try:
            args = contract.arguments.model_validate(arguments).model_dump()
        except ValidationError:
            raise ServiceError(ErrorCode.INVALID_ARGUMENTS) from None
        search = tool == "search_knowledge"
        routes = {
            "get_access_catalog": ("GET", "/internal/v1/ai/access/catalog"),
            "submit_access_request": ("POST", "/internal/v1/ai/access/requests"),
            "get_access_requests": ("GET", "/internal/v1/ai/access/requests"),
            "get_knowledge_page": ("POST", "/internal/v1/ai/knowledge/page"),
            "search_knowledge": ("POST", "/internal/v1/ai/knowledge/search"),
            "get_team_context": ("GET", "/internal/v1/ai/team-context"),
            "get_onboarding_progress": ("GET", "/internal/v1/ai/onboarding/progress"),
            "get_task_context": ("POST", "/internal/v1/ai/onboarding/task-context"),
            "get_task_evidence": ("POST", "/internal/v1/ai/onboarding/task-evidence"),
        }
        method, path = routes[tool]
        try:
            status, body = await self.request(
                method,
                path,
                token=principal.api_token,
                request_id=principal.request_id,
                timeout=min(self.settings.read_timeout, remaining),
                max_bytes=MAX_RESULT_BYTES,
                payload=args if method == "POST" else None,
            )
        except ServiceError as error:
            if principal.expires_at <= datetime.now(UTC):
                raise ServiceError(ErrorCode.CONTEXT_EXPIRED) from None
            raise error from None
        if principal.expires_at <= datetime.now(UTC):
            raise ServiceError(ErrorCode.CONTEXT_EXPIRED)
        try:
            data = closed_json(body)
            if not isinstance(data, dict) or type(data.get("ok")) is not bool:
                raise ValueError("invalid envelope flag")
            if status != 200:
                expected = ERRORS[status]
                failure = FailureEnvelope.model_validate_json(body)
                if failure.error.code != expected.value:
                    raise ValueError("HTTP/code mismatch")
                raise ServiceError(expected)
            value = contract.result.model_validate_json(body).model_dump()
            if search and len(value["data"]["documents"]) > args["limit"]:
                raise ValueError("search limit exceeded")
            return value
        except (ValueError, TypeError, ValidationError):
            raise ServiceError(ErrorCode.INVALID_RESULT) from None
