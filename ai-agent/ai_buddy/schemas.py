import re
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)

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


class SelectionResource(ClosedModel):
    kind: Literal["task", "confluence", "work_tool", "jira", "service"]
    id: Annotated[str, Field(max_length=128, pattern=r"^[A-Za-z0-9_.:-]*$")] = ""
    service: Annotated[str, Field(max_length=32)] = ""
    label: Annotated[str, Field(max_length=200)] = ""
    description: Annotated[str, Field(max_length=800)] = ""
    page_ids: Annotated[
        list[
            Annotated[
                str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
            ]
        ],
        Field(max_length=3),
    ] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_resource(self) -> "SelectionResource":
        if len(set(self.page_ids)) != len(self.page_ids):
            raise ValueError("duplicate page ids")
        work = {
            "mattermost",
            "redash",
            "trino",
            "trisigma",
            "bitbucket",
            "paas",
            "grafana",
            "tms",
            "postman",
            "test-stand",
            "figma",
            "design-system",
            "design-review",
        }
        services = {
            "absences",
            "trips",
            "hiring",
            "offboarding",
            "consents",
            "benefits",
            "documents",
            "events",
            "access",
        }
        if "\0" in self.label + self.description or (
            self.kind != "task" and (self.description or self.page_ids)
        ):
            raise ValueError("invalid resource text")
        if self.kind == "service":
            valid = not self.id and self.service in services
        elif self.kind == "work_tool":
            valid = bool(self.id) and self.service in work
        else:
            valid = bool(self.id) and not self.service
            if self.kind == "task":
                valid = valid and bool(self.label.strip())
            if self.kind == "jira":
                valid = valid and bool(
                    re.fullmatch(
                        r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", self.id
                    )
                )
        if not valid:
            raise ValueError("invalid selection resource")
        return self


class Selection(ClosedModel):
    text: Annotated[str, Field(min_length=1, max_length=1200)]
    title: Annotated[str, Field(max_length=200)]
    resource: SelectionResource | None = None

    @model_validator(mode="after")
    def valid_selection(self) -> "Selection":
        if not self.text.strip() or "\0" in self.text + self.title:
            raise ValueError("invalid selection")
        return self


class PageContext(ClosedModel):
    selection: Selection | None = None
    url: Annotated[str, Field(min_length=1, max_length=2048)]

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        safe_url(value)
        parts = urlsplit(value)
        if parts.query or parts.fragment:
            raise ValueError("URL must be sanitized by Go")
        return value


class HRDayEvent(ClosedModel):
    id: str
    title: str
    detail: str
    service: Literal["absences", "trips"]


class HRDay(ClosedModel):
    events: list[HRDayEvent]
    unavailable: list[Literal["absences", "trips"]]


class TurnRequest(ClosedModel):
    request_id: UUID
    conversation_id: UUID
    message: ShortText
    delegation_token: SecretStr = Field(min_length=1, max_length=8192)
    history: Annotated[list[HistoryMessage], Field(max_length=20)] = Field(
        default_factory=list
    )
    page_context: PageContext | None = None
    hr_today: HRDay | None = None

    @model_validator(mode="after")
    def selection_question(self) -> "TurnRequest":
        if (
            self.page_context
            and self.page_context.selection
            and len(self.message) > 700
        ):
            raise ValueError("selection question too long")
        return self

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


class TaskArguments(ClosedModel):
    task_id: Identifier


class ProgressTask(ClosedModel):
    id: Identifier
    title: Annotated[str, Field(min_length=1, max_length=200)]
    status: Literal["pending", "completed"]


class ProgressData(ClosedModel):
    tasks: Annotated[list[ProgressTask], Field(max_length=100)]
    next_task_id: Identifier | None
    references: Annotated[list[Source], Field(max_length=5)]


class TaskData(ClosedModel):
    task_id: Identifier
    title: Annotated[str, Field(min_length=1, max_length=200)]
    guidance: ShortText
    action_url: str | None
    references: Annotated[list[Source], Field(max_length=5)]

    @field_validator("action_url")
    @classmethod
    def validate_action_url(cls, value: str | None) -> str | None:
        return safe_url(value, relative=True) if value else value


class EvidenceItem(ClosedModel):
    version: Annotated[str, Field(min_length=1, max_length=128)]
    kind: Literal["consent", "document", "event"]
    confirmed: bool
    summary: Annotated[str, Field(min_length=1, max_length=1200)]


class EvidenceData(ClosedModel):
    task_id: Identifier
    items: Annotated[list[EvidenceItem], Field(max_length=10)]
    references: Annotated[list[Source], Field(max_length=5)]


class ProgressEnvelope(ClosedModel):
    ok: Literal[True]
    data: ProgressData


class TaskEnvelope(ClosedModel):
    ok: Literal[True]
    data: TaskData


class EvidenceEnvelope(ClosedModel):
    ok: Literal[True]
    data: EvidenceData


class AccessArguments(ClosedModel):
    template_id: Identifier
    catalog_version: Annotated[int, Field(ge=1, le=1)]
    system: Annotated[str, Field(min_length=1, max_length=120)]
    resource_key: Annotated[str, Field(min_length=1, max_length=160)]
    justification: Annotated[str, Field(min_length=10, max_length=2000)]
    permission: Literal["read", "write", "admin"]
    duration_days: Annotated[int, Field(ge=1, le=90)]
    fields: dict[str, Annotated[str, Field(min_length=1, max_length=500)]]


class AccessField(ClosedModel):
    key: str
    label: str
    placeholder: str | None = None
    options: list[str] | None = None


class AccessResource(ClosedModel):
    resource_key: str
    fields: dict[str, str]


class AccessTemplate(ClosedModel):
    id: str
    title: str
    description: str
    icon: str
    color: str
    roles: list[str]
    system: str
    keyHint: str
    levels: list[Literal["read", "write", "admin"]]
    fields: list[AccessField]
    owner: str
    resources: list[AccessResource]


class AccessIdentity(ClosedModel):
    profile_id: str
    product_id: str
    job_role: str
    name: str
    team_name: str
    can_review: bool


class AccessCatalogData(ClosedModel):
    version: int
    templates: Annotated[list[AccessTemplate], Field(max_length=20)]
    context: AccessIdentity
    references: Annotated[list[Source], Field(max_length=5)]


class AccessSummary(ClosedModel):
    id: str
    number: str
    status: Literal["submitted", "approved", "rejected", "cancelled"]
    system: str
    resource_key: str
    permission: Literal["read", "write", "admin"]
    duration_days: int


class AccessSubmitData(ClosedModel):
    request: AccessSummary
    references: Annotated[list[Source], Field(min_length=1, max_length=5)]


class AccessListData(ClosedModel):
    requests: Annotated[list[AccessSummary], Field(max_length=20)]
    references: Annotated[list[Source], Field(max_length=5)]


class AccessCatalogEnvelope(ClosedModel):
    ok: Literal[True]
    data: AccessCatalogData


class AccessSubmitEnvelope(ClosedModel):
    ok: Literal[True]
    data: AccessSubmitData


class AccessListEnvelope(ClosedModel):
    ok: Literal[True]
    data: AccessListData


class KnowledgeArguments(ClosedModel):
    page_id: Identifier


class KnowledgePage(ClosedModel):
    id: str
    product_id: str | None
    parent_id: str | None
    kind: Literal["product", "team", "role", "guide"]
    title: str
    body: Annotated[str, Field(max_length=12000)]
    version: int
    updated_at: str


class KnowledgePageData(ClosedModel):
    page: KnowledgePage
    references: Annotated[list[Source], Field(max_length=5)]


class KnowledgePageEnvelope(ClosedModel):
    ok: Literal[True]
    data: KnowledgePageData
