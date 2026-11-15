"""Explicit model selection; no cross-provider fallback."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from ai_buddy.agent import Chat
from ai_buddy.config import Settings
from ai_buddy.deepseek import deepseek_session
from ai_buddy.ollama import ollama_session


@asynccontextmanager
async def model_session(
    settings: Settings,
    *,
    response_schema: dict[str, Any] | None = None,
    max_output_tokens: int = 384,
) -> AsyncIterator[Chat]:
    factory = (
        deepseek_session if settings.llm_provider == "deepseek" else ollama_session
    )
    async with factory(
        settings, response_schema=response_schema, max_output_tokens=max_output_tokens
    ) as chat:
        yield chat
