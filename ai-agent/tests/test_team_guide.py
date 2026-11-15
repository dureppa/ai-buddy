from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest

from ai_buddy.team_guide import TeamBrief, TeamGuide, generate_team_guide
from tests.helpers import settings


@pytest.mark.parametrize(
    "content, valid",
    [
        (
            (
                '{"cards":[{"title":"Поиск","text":"Проверяем VIN."},'
                '{"title":"Отчёт","text":"Сверяем данные."},'
                '{"title":"Сценарии","text":"Проверяем госномер."}]}'
            ),
            True,
        ),
        ('{"cards":[{"title":"Поиск","text":"Проверяем VIN."}]}', False),
    ],
)
def test_team_guide_validates_provider_output(
    monkeypatch: pytest.MonkeyPatch, content: str, valid: bool
) -> None:
    from asyncio import run

    from pydantic import ValidationError

    from ai_buddy.agent import Chat

    @asynccontextmanager
    async def fake_session(*_args: object, **kwargs: object) -> AsyncIterator[Chat]:
        assert kwargs["response_schema"] == TeamGuide.model_json_schema()

        async def chat(
            messages: list[dict[str, object]], tools: list[dict[str, object]]
        ) -> dict[str, object]:
            assert not tools
            assert "Автотека" in str(messages[-1]["content"])
            return {"role": "assistant", "content": content}

        yield chat

    monkeypatch.setattr("ai_buddy.team_guide.model_session", fake_session)
    task = generate_team_guide(
        settings(),
        TeamBrief(team="Качество отчётов", product="Автотека", brief="Проверяем VIN."),
    )
    if valid:
        assert run(task).cards[0].title == "Поиск"
    else:
        with pytest.raises(ValidationError):
            run(task)
