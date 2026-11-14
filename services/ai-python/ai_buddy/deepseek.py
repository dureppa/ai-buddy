"""Bounded OpenAI-compatible transport using the project's existing httpx."""

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx

from ai_buddy.agent import Chat
from ai_buddy.config import Settings
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.ollama import MAX_BYTES, ModelMessage


def wire_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    pending: list[str] = []
    for message in messages:
        value = dict(message)
        if value["role"] == "assistant" and value.get("tool_calls"):
            calls: list[dict[str, Any]] = []
            for call in value["tool_calls"]:
                identifier = call.get("id", f"call_{len(result)}_{len(calls)}")
                pending.append(identifier)
                function = call["function"]
                calls.append(
                    {
                        "id": identifier,
                        "type": "function",
                        "function": {
                            "name": function["name"],
                            "arguments": json.dumps(
                                function["arguments"],
                                ensure_ascii=False,
                                allow_nan=False,
                            ),
                        },
                    }
                )
            value["tool_calls"] = calls
        elif value["role"] == "tool":
            if not pending:
                raise ValueError("orphan tool result")
            value.pop("tool_name", None)
            value["tool_call_id"] = pending.pop(0)
        if value["role"] == "assistant" and not value.get("tool_calls"):
            value.pop("tool_calls", None)
        result.append(value)
    if pending:
        raise ValueError("missing tool results")
    return result


def parse_response(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict) or len(data.get("choices", [])) != 1:
        raise ValueError("one choice required")
    choice = data["choices"][0]
    message = choice["message"]
    if choice["finish_reason"] not in {"stop", "tool_calls"}:
        raise ValueError("incomplete generation")
    if message.get("role") != "assistant":
        raise ValueError("invalid role")
    calls = message.get("tool_calls") or []
    if (choice["finish_reason"] == "tool_calls") != bool(calls):
        raise ValueError("inconsistent finish reason")
    if len(calls) > 6:
        raise ValueError("too many calls")
    normalized = []
    seen = set()
    for call in calls:
        if (
            call["type"] != "function"
            or not isinstance(call["id"], str)
            or not call["id"]
            or call["id"] in seen
        ):
            raise ValueError("invalid tool call")
        seen.add(call["id"])
        function = call["function"]
        arguments = json.loads(function["arguments"])
        normalized.append(
            {"function": {"name": function["name"], "arguments": arguments}}
        )
    # Only the validated assistant message is returned. Discard reasoning and metadata.
    parsed = ModelMessage.model_validate(
        {
            "role": "assistant",
            "content": message.get("content") or "",
            "tool_calls": normalized,
        }
    ).model_dump()
    for normalized_call, original in zip(parsed["tool_calls"], calls, strict=True):
        normalized_call["id"] = original["id"]
    return parsed


@asynccontextmanager
async def deepseek_session(
    settings: Settings,
    *,
    response_schema: dict[str, Any] | None = None,
    max_output_tokens: int = 384,
) -> AsyncIterator[Chat]:
    if settings.deepseek_api_key is None:
        raise ServiceError(ErrorCode.NOT_READY)
    api_key = settings.deepseek_api_key.get_secret_value()
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(settings.model_timeout),
        transport=httpx.AsyncHTTPTransport(retries=0),
        trust_env=False,
        follow_redirects=False,
    ) as client:

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            try:
                payload: dict[str, Any] = {
                    "model": settings.deepseek_model,
                    "messages": wire_messages(messages),
                    "stream": False,
                    "thinking": {"type": "disabled"},
                    "temperature": 0,
                    "max_tokens": max_output_tokens,
                }
                if tools:
                    payload["tools"] = tools
                if response_schema is not None:
                    payload["response_format"] = {"type": "json_object"}
                    payload["messages"] = [
                        {
                            "role": "system",
                            "content": "Return JSON matching this schema: "
                            + json.dumps(response_schema, ensure_ascii=False),
                        },
                        *payload["messages"],
                    ]
                body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
                if len(body) > MAX_BYTES:
                    raise ServiceError(ErrorCode.INVALID_REQUEST)
                async with asyncio.timeout(settings.model_timeout):
                    async with client.stream(
                        "POST",
                        settings.deepseek_base_url + "/chat/completions",
                        content=body,
                        headers={
                            "Authorization": "Bearer " + api_key,
                            "Content-Type": "application/json",
                        },
                    ) as response:
                        if response.status_code == 429:
                            raise ServiceError(ErrorCode.AI_RATE_LIMITED)
                        if response.status_code != 200:
                            raise ServiceError(ErrorCode.AI_UNAVAILABLE)
                        raw = bytearray()
                        async for chunk in response.aiter_bytes():
                            raw.extend(chunk)
                            if len(raw) > MAX_BYTES:
                                raise ServiceError(ErrorCode.AI_INVALID_RESPONSE)
                data = json.loads(raw)
                json.dumps(data, allow_nan=False)
                return parse_response(data)
            except (TimeoutError, httpx.TimeoutException):
                raise ServiceError(ErrorCode.AI_TIMEOUT) from None
            except httpx.HTTPError:
                raise ServiceError(ErrorCode.AI_UNAVAILABLE) from None
            except (ValueError, TypeError, KeyError, IndexError):
                raise ServiceError(ErrorCode.AI_INVALID_RESPONSE) from None

        yield chat
