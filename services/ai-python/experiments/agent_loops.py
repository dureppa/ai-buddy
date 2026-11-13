"""Paired local agent loops sharing the application's validated MCP boundary."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, Literal

import httpx
from langchain.agents import create_agent
from langchain.agents.middleware import wrap_model_call, wrap_tool_call
from langchain.agents.middleware.types import (
    ModelRequest,
    ModelResponse,
    ToolCallRequest,
)
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import ToolMessage
from langchain_ollama import ChatOllama
from langgraph.types import Command

from ai_buddy.agent import PROMPT, Chat, Trace, direct_loop, finalize, tool_schemas
from ai_buddy.errors import ServiceError
from ai_buddy.mcp_client import Gateway

__all__ = [
    "MODEL",
    "OPTIONS",
    "PROMPT",
    "URL",
    "Chat",
    "Trace",
    "direct_loop",
    "ollama_chat",
    "ollama_model",
    "run_loop",
    "tool_schemas",
]

MODEL = "qwen3:4b-q4_K_M"
URL = "http://127.0.0.1:11434"
OPTIONS = {"temperature": 0, "seed": 42, "num_ctx": 4096, "num_predict": 384}


async def langchain_loop(
    gateway: Gateway, question: str, model: BaseChatModel, trace: Trace
) -> str:
    @wrap_model_call
    async def bounded_model(
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        trace.before_model()
        return await handler(request)

    @wrap_tool_call
    async def validated_tool(
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage:
        # Shared executor makes limits, validation and failure payloads identical.
        call = request.tool_call
        content = await trace.execute(gateway, call["name"], call["args"])
        return ToolMessage(content=content, tool_call_id=call["id"])

    # Callable tools give create_agent a ToolNode; middleware above is the MCP adapter.
    from langchain_core.tools import StructuredTool

    async def unused(**arguments: Any) -> str:
        raise RuntimeError("MCP middleware must execute all calls")

    tools = [
        StructuredTool.from_function(
            coroutine=unused,
            name=tool["function"]["name"],
            description=tool["function"]["description"],
            args_schema=tool["function"]["parameters"],
        )
        for tool in tool_schemas(gateway.available)
    ]
    agent = create_agent(
        model=model,
        tools=tools,
        system_prompt=PROMPT,
        middleware=[bounded_model, validated_tool],
    )
    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": question}]},
        config={"recursion_limit": 12, "max_concurrency": 1},
    )
    answer = result["messages"][-1].content
    if isinstance(answer, str):
        feedback = trace.repair_feedback(answer)
        if feedback is not None:
            result = await agent.ainvoke(
                {
                    "messages": [
                        *result["messages"],
                        {"role": "user", "content": feedback},
                    ]
                },
                config={"recursion_limit": 12, "max_concurrency": 1},
            )
            answer = result["messages"][-1].content
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("empty model response")
    return answer


async def run_loop(
    engine: Literal["direct", "langchain"],
    gateway: Gateway,
    question: str,
    *,
    chat: Chat | None = None,
    model: BaseChatModel | None = None,
    deadline: float = 90,
) -> Trace:
    trace = Trace()
    try:
        async with asyncio.timeout(deadline):
            await gateway.discover()
            if engine == "direct":
                if chat is None:
                    raise ValueError("chat required")
                trace.raw_answer = await direct_loop(gateway, question, chat, trace)
            else:
                if model is None:
                    raise ValueError("model required")
                trace.raw_answer = await langchain_loop(gateway, question, model, trace)
            finalize(trace)
    except ServiceError as error:
        trace.error = error.code.value
    except TimeoutError:
        trace.error = "DEADLINE"
    except Exception:  # noqa: BLE001 -- experimental report contains only safe error categories
        trace.error = "MODEL_ERROR"
    return trace


async def ollama_chat(
    messages: list[dict[str, Any]], tools: list[dict[str, Any]]
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=90, trust_env=False) as client:
        response = await client.post(
            URL + "/api/chat",
            json={
                "model": MODEL,
                "messages": messages,
                "tools": tools,
                "stream": False,
                "think": False,
                "options": OPTIONS,
            },
        )
        response.raise_for_status()
        message: dict[str, Any] = response.json()["message"]
        return message


def ollama_model() -> ChatOllama:
    return ChatOllama(
        model=MODEL,
        base_url=URL,
        reasoning=False,
        temperature=0,
        seed=42,
        num_ctx=4096,
        num_predict=384,
        disable_streaming=True,
        client_kwargs={"timeout": 90, "trust_env": False},
    )
