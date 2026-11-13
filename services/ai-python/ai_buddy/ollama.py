"""Bounded native Ollama HTTP adapter; private response data never leaves this layer."""

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ai_buddy.agent import Chat
from ai_buddy.config import Settings
from ai_buddy.errors import ErrorCode, ServiceError

MAX_BYTES = 64 * 1024


class ToolFunction(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    name: str = Field(min_length=1, max_length=128)
    arguments: dict[str, Any]


class ToolCall(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    function: ToolFunction


class ModelMessage(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    role: Literal["assistant"]
    content: str = Field(default="", max_length=4000)
    tool_calls: list[ToolCall] = Field(default_factory=list, max_length=128)

    @model_validator(mode="after")
    def nonempty(self) -> "ModelMessage":
        if not self.tool_calls and not self.content.strip():
            raise ValueError("empty model answer")
        return self


class ChatResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    done: Literal[True]
    done_reason: str | None = None
    message: ModelMessage


@asynccontextmanager
async def ollama_session(settings: Settings) -> AsyncIterator[Chat]:
    if settings.ollama_model is None:
        raise ServiceError(ErrorCode.NOT_READY)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(settings.model_timeout),
        transport=httpx.AsyncHTTPTransport(retries=0),
        trust_env=False,
        follow_redirects=False,
    ) as client:

        async def chat(
            messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> dict[str, Any]:
            body = json.dumps(
                {
                    "model": settings.ollama_model,
                    "messages": messages,
                    "tools": tools,
                    "stream": False,
                    "think": False,
                    "options": {
                        "temperature": 0,
                        "seed": 42,
                        "num_ctx": 4096,
                        "num_predict": 384,
                    },
                },
                ensure_ascii=False,
                allow_nan=False,
            ).encode()
            if len(body) > MAX_BYTES:
                raise ServiceError(ErrorCode.INVALID_REQUEST)
            try:
                async with asyncio.timeout(settings.model_timeout):
                    async with client.stream(
                        "POST",
                        settings.ollama_url + "/api/chat",
                        content=body,
                        headers={"Content-Type": "application/json"},
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
                parsed = ChatResponse.model_validate(data)
                if parsed.done_reason not in {None, "stop"}:
                    raise ValueError("incomplete generation")
                # Deliberately drop thinking, metrics, unknown fields and tool index/id.
                return parsed.message.model_dump()
            except (TimeoutError, httpx.TimeoutException):
                raise ServiceError(ErrorCode.AI_TIMEOUT) from None
            except httpx.RequestError:
                raise ServiceError(ErrorCode.AI_UNAVAILABLE) from None
            except (ValueError, TypeError, ValidationError):
                raise ServiceError(ErrorCode.AI_INVALID_RESPONSE) from None

        yield chat
