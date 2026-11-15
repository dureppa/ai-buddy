"""Generate short team cards from a trusted team brief."""

from pydantic import BaseModel, ConfigDict, Field

from ai_buddy.config import Settings
from ai_buddy.provider import model_session


class TeamBrief(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    team: str = Field(min_length=1, max_length=120)
    product: str = Field(min_length=1, max_length=120)
    brief: str = Field(min_length=1, max_length=2000)


class TeamCard(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    title: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=280)


class TeamGuide(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cards: list[TeamCard] = Field(min_length=3, max_length=3)


async def generate_team_guide(settings: Settings, brief: TeamBrief) -> TeamGuide:
    async with model_session(
        settings, response_schema=TeamGuide.model_json_schema(), max_output_tokens=768
    ) as chat:
        message = await chat(
            [
                {
                    "role": "system",
                    "content": (
                        "Напиши по-русски три короткие карточки для стажёра о том, "
                        "чем занимается команда. Используй только сведения из брифа. "
                        "Не выдумывай названия систем, метрики, практики или людей. "
                        "Верни JSON с полем cards и полями title и text в каждой карточке."
                    ),
                },
                {"role": "user", "content": brief.model_dump_json()},
            ],
            [],
        )
    content = message.get("content")
    if not isinstance(content, str) or message.get("tool_calls"):
        raise ValueError("invalid team guide response")
    return TeamGuide.model_validate_json(content)
