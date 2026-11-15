"""Closed contracts for service reads and server-owned confirmation drafts."""

from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from ai_buddy.schemas import ClosedModel, Identifier, Source, safe_url

ServiceName = Literal["hiring", "offboarding", "benefits", "jira"]
UUIDString = Annotated[
    str,
    Field(
        pattern=r"^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$"
    ),
]
DateString = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]


class ServiceContextArguments(ClosedModel):
    service: ServiceName
    board_id: Identifier | None = None
    issue_id: UUIDString | None = Field(
        default=None,
        description="UUID из поля id задачи. DEL-1 — ключ: сначала читай service=jira без issue_id.",
    )

    @model_validator(mode="after")
    def resource_scope(self) -> "ServiceContextArguments":
        if (self.board_id or self.issue_id) and self.service != "jira":
            raise ValueError("Jira resource only")
        if self.board_id and self.issue_id:
            raise ValueError("one resource at a time")
        return self


class Vacancy(ClosedModel):
    id: Identifier
    title: str
    description: str


class Referral(ClosedModel):
    id: UUIDString
    vacancy: Identifier
    name: str
    email: str
    status: str


class HiringContext(ClosedModel):
    service: Literal["hiring"]
    referral_slots: Annotated[int, Field(ge=0)]
    referral_left: int
    vacancies: Annotated[list[Vacancy], Field(max_length=50)]
    referrals: Annotated[list[Referral], Field(max_length=30)]
    has_more: bool
    references: Annotated[list[Source], Field(max_length=5)]


class ExitStep(ClosedModel):
    id: Identifier
    title: str
    description: str


class ExitDraft(ClosedModel):
    date: DateString


class OffboardingContext(ClosedModel):
    service: Literal["offboarding"]
    exit_notice_days: Annotated[int, Field(ge=0)]
    earliest_exit: DateString
    steps: Annotated[list[ExitStep], Field(max_length=50)]
    checklist: Annotated[list[Identifier], Field(max_length=50)]
    draft: ExitDraft | None
    references: Annotated[list[Source], Field(max_length=5)]


class Benefit(ClosedModel):
    id: Identifier
    title: str
    description: str
    amount: Annotated[int, Field(ge=0)]
    available: bool


class BenefitRequest(ClosedModel):
    id: UUIDString
    benefit: Identifier
    amount: Annotated[int, Field(ge=0)]
    status: str


class BenefitsContext(ClosedModel):
    service: Literal["benefits"]
    benefit_budget: Annotated[int, Field(ge=0)]
    benefit_left: int
    options: Annotated[list[Benefit], Field(max_length=50)]
    requests: Annotated[list[BenefitRequest], Field(max_length=30)]
    has_more: bool
    references: Annotated[list[Source], Field(max_length=5)]


class JiraIssue(ClosedModel):
    id: UUIDString
    board_id: Identifier
    space_id: Identifier
    key: str
    title: str
    description: str
    description_truncated: bool
    status: Literal["todo", "in_progress", "review", "done"]
    priority: Literal["low", "medium", "high"]
    assignee_id: Identifier | None
    reporter_id: Identifier
    due_date: DateString | None
    version: Annotated[int, Field(ge=1)]


class JiraSpace(ClosedModel):
    id: Identifier
    name: str


class JiraBoard(ClosedModel):
    id: Identifier
    name: str
    space_id: Identifier
    key: str


class JiraMember(ClosedModel):
    id: Identifier
    name: str


class JiraContext(ClosedModel):
    service: Literal["jira"]
    current_user_id: Identifier
    spaces: Annotated[list[JiraSpace], Field(max_length=20)]
    boards: Annotated[list[JiraBoard], Field(max_length=30)]
    issues: Annotated[list[JiraIssue], Field(max_length=20)]
    members: Annotated[list[JiraMember], Field(max_length=50)]
    has_more: bool
    references: Annotated[list[Source], Field(max_length=5)]


class ServiceContextEnvelope(ClosedModel):
    ok: Literal[True]
    data: Annotated[
        HiringContext | OffboardingContext | BenefitsContext | JiraContext,
        Field(discriminator="service"),
    ]


class ReferCandidate(ClosedModel):
    operation: Literal["refer_candidate"]
    vacancy: Identifier
    name: Annotated[str, Field(min_length=2, max_length=100)]
    email: Annotated[str, Field(min_length=3, max_length=200)]


class SetExitStep(ClosedModel):
    operation: Literal["set_exit_step"]
    step: Identifier
    checked: bool


class SaveExitDraft(ClosedModel):
    operation: Literal["save_exit_draft"]
    date: DateString


class RequestBenefit(ClosedModel):
    operation: Literal["request_benefit"]
    benefit: Identifier


class CreateJiraIssue(ClosedModel):
    operation: Literal["create_jira_issue"]
    board_id: Identifier
    title: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(max_length=4000)] = ""
    status: Literal["todo", "in_progress", "review", "done"] = "todo"
    priority: Literal["low", "medium", "high"] = "medium"
    assignee_id: Identifier | None = None
    due_date: DateString | None = None


class JiraChanges(ClosedModel):
    title: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    description: Annotated[str, Field(max_length=4000)] | None = None
    status: Literal["todo", "in_progress", "review", "done"] | None = None
    priority: Literal["low", "medium", "high"] | None = None
    assignee_id: Identifier | None = None
    due_date: DateString | None = None

    @model_validator(mode="after")
    def requested_changes(self) -> "JiraChanges":
        if not self.model_fields_set:
            raise ValueError("at least one change")
        for field in self.model_fields_set - {"assignee_id", "due_date"}:
            if getattr(self, field) is None:
                raise ValueError("non-null change required")
        return self


class UpdateJiraIssue(ClosedModel):
    operation: Literal["update_jira_issue"]
    issue_id: UUIDString = Field(
        description="UUID из поля id доступной задачи; не человекочитаемый ключ DEL-1."
    )
    version: Annotated[int, Field(ge=1)]
    changes: JiraChanges


class PrepareServiceActionArguments(ClosedModel):
    action: Annotated[
        ReferCandidate
        | SetExitStep
        | SaveExitDraft
        | RequestBenefit
        | CreateJiraIssue
        | UpdateJiraIssue,
        Field(discriminator="operation"),
    ]


class ActionField(ClosedModel):
    label: Annotated[str, Field(min_length=1, max_length=120)]
    value: Annotated[str, Field(max_length=12000)]


class ServiceActionDraft(ClosedModel):
    id: UUIDString
    service: ServiceName
    operation: Literal[
        "refer_candidate",
        "set_exit_step",
        "save_exit_draft",
        "request_benefit",
        "create_jira_issue",
        "update_jira_issue",
    ]
    state: Literal[
        "prepared",
        "executing",
        "succeeded",
        "failed",
        "uncertain",
        "cancelled",
        "expired",
    ]
    title: str
    fields: Annotated[list[ActionField], Field(max_length=15)]
    expires_at: str
    service_url: str
    result: str

    @field_validator("service_url")
    @classmethod
    def public_url(cls, value: str) -> str:
        return safe_url(value)


class ServiceActionData(ClosedModel):
    draft: ServiceActionDraft
    references: Annotated[list[Source], Field(min_length=1, max_length=5)]


class ServiceActionEnvelope(ClosedModel):
    ok: Literal[True]
    data: ServiceActionData
