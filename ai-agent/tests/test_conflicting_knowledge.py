import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest

from ai_buddy.mcp_client import Gateway
from ai_buddy.runner import DirectRunner
from tests.helpers import FakeSession, context, result, settings


@pytest.mark.parametrize(
    ("excerpts", "response", "expected_ids"),
    [
        (
            ["Проверка до публикации.", "Проверка после публикации."],
            (
                "Инструкции расходятся. Сначала проверка [guide-1]. "
                "Или сначала публикация [guide-2]. Уточни порядок у наставника."
            ),
            [1, 2],
        ),
        (
            ["Проверка до публикации."],
            "Сначала отправь отчёт на проверку [guide-1].",
            [1],
        ),
        (
            ["Проверка до публикации.", "После проверки опубликуй отчёт."],
            "Отправь отчёт на проверку [guide-1], затем опубликуй [guide-2].",
            [1, 2],
        ),
    ],
)
def test_instruction_comparison_uses_only_retrieved_sources(
    monkeypatch: pytest.MonkeyPatch,
    excerpts: list[str],
    response: str,
    expected_ids: list[int],
) -> None:
    session = FakeSession()
    documents = [
        {
            "source": {
                "id": f"guide-{index}",
                "title": f"Гайд {index}",
                "url": f"/guide/{index}",
                "version": "1",
                "is_demo": True,
            },
            "excerpt": excerpt,
        }
        for index, excerpt in enumerate(excerpts, 1)
    ]
    session.response = result({"ok": True, "data": {"documents": documents}})

    async def chat(
        messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> dict[str, Any]:
        assert "несовместимые указания" in messages[0]["content"]
        assert "отдельной цитатой" in messages[0]["content"]
        assert all(excerpt in messages[-2]["content"] for excerpt in excerpts)
        if len(excerpts) == 1:
            assert "guide-2" not in messages[-2]["content"]
        return {"role": "assistant", "content": response}

    @asynccontextmanager
    async def model_session(config: Any) -> AsyncIterator[Any]:
        yield chat

    monkeypatch.setattr("ai_buddy.runner.model_session", model_session)

    async def run() -> None:
        request = context(message="Как оформить первый учебный отчёт «Компас»?")
        config = settings()
        gateway = Gateway(session, request, config)
        await gateway.discover()
        reply = await DirectRunner(config).run(request, gateway)
        assert [item.url for item in reply.references] == [
            f"/guide/{index}" for index in expected_ids
        ]
        assert "[guide-" not in reply.text
        assert [name for name, _, _ in session.calls] == ["search_knowledge"]

    asyncio.run(run())
