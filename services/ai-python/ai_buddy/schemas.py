import re
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

Identifier = Annotated[
    str, Field(min_length=1, max_length=128, pattern=r"^[^\s\x00-\x1f\x7f]+$")
]
ShortText = Annotated[str, Field(min_length=1, max_length=4000)]


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


def safe_url(value: str, *, relative: bool = False) -> str:
    if "\\" in value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("unsafe URL characters")
    parts = urlsplit(value)
    if relative and value.startswith("/") and not value.startswith("//"):
        return value
    if (
        parts.scheme not in {"http", "https"}
        or not parts.hostname
        or parts.username
        or parts.password
    ):
        raise ValueError("unsupported URL")
    return value


class HistoryMessage(ClosedModel):
    role: Literal["user", "assistant"]
    content: ShortText


class PageContext(ClosedModel):
    url: Annotated[str, Field(min_length=1, max_length=2048)]

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        safe_url(value)
        parts = urlsplit(value)
        if parts.query or parts.fragment:
            raise ValueError("URL must be sanitized by Go")
        return value


class TurnRequest(ClosedModel):
    request_id: UUID
    conversation_id: UUID
    message: ShortText
    delegation_token: SecretStr = Field(min_length=1, max_length=8192)
    history: Annotated[list[HistoryMessage], Field(max_length=20)] = Field(
        default_factory=list
    )
    page_context: PageContext | None = None

    @field_validator("message")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("empty message")
        return value

    @field_validator("delegation_token")
    @classmethod
    def header_safe(cls, value: SecretStr) -> SecretStr:
        if any(ord(c) < 33 or ord(c) == 127 for c in value.get_secret_value()):
            raise ValueError("invalid delegation token")
        return value


class Reference(ClosedModel):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    url: Annotated[str, Field(min_length=1, max_length=2048)]

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return safe_url(value, relative=True)


class Reply(ClosedModel):
    text: ShortText
    references: Annotated[list[Reference], Field(max_length=5)] = Field(
        default_factory=list
    )


class SearchArguments(ClosedModel):
    query: Annotated[str, Field(min_length=1, max_length=500)]
    limit: Annotated[int, Field(ge=1, le=5)] = 3

    @field_validator("query", mode="before")
    @classmethod
    def normalize(cls, value: object) -> object:
        return re.sub(r"\s+", " ", value).strip() if isinstance(value, str) else value


class EmptyArguments(ClosedModel):
    pass


class Source(Reference):
    id: Identifier
    version: Annotated[str, Field(min_length=1, max_length=64)]
    is_demo: bool


class Document(ClosedModel):
    source: Source
    excerpt: Annotated[str, Field(min_length=1, max_length=1200)]


class SearchData(ClosedModel):
    documents: Annotated[list[Document], Field(max_length=5)]


class Team(ClosedModel):
    id: Identifier
    name: Annotated[str, Field(min_length=1, max_length=120)]
    summary: Annotated[str, Field(min_length=1, max_length=1200)]


class Contact(ClosedModel):
    display_name: Annotated[str, Field(min_length=1, max_length=120)]
    contact: Annotated[str, Field(min_length=1, max_length=300)]


class TeamData(ClosedModel):
    team: Team | None
    mentor: Contact | None
    lead: Contact | None
    references: Annotated[list[Source], Field(max_length=5)]


class ToolFailure(ClosedModel):
    code: Annotated[str, Field(min_length=1, max_length=64)]
    message: Annotated[str, Field(max_length=300)]
    retryable: bool


class FailureEnvelope(ClosedModel):
    ok: Literal[False]
    error: ToolFailure


class SearchEnvelope(ClosedModel):
    ok: Literal[True]
    data: SearchData


class TeamEnvelope(ClosedModel):
    ok: Literal[True]
    data: TeamData
