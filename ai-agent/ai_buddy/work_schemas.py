"""Closed read contracts for the standalone role-specific work tools."""

from typing import Annotated, Literal

from pydantic import Field

from ai_buddy.schemas import ClosedModel, Identifier, Source

WorkService = Literal[
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
]


class WorkToolSummary(ClosedModel):
    id: WorkService | Literal["jira", "confluence"]
    name: Annotated[str, Field(min_length=1, max_length=200)]
    area: Annotated[str, Field(max_length=200)]
    read_tool: Literal[
        "get_work_tool_context", "get_service_context", "search_knowledge"
    ]


class WorkToolsData(ClosedModel):
    tools: Annotated[list[WorkToolSummary], Field(max_length=15)]
    references: Annotated[list[Source], Field(min_length=1, max_length=5)]


class WorkToolsEnvelope(ClosedModel):
    ok: Literal[True]
    data: WorkToolsData


class WorkContextArguments(ClosedModel):
    service: WorkService
    record_id: Identifier | None = None


class WorkRecord(ClosedModel):
    id: Identifier
    title: Annotated[str, Field(min_length=1, max_length=2000)]
    status: Annotated[str, Field(max_length=200)]
    description: Annotated[str, Field(max_length=2000)]
    fields: Annotated[dict[str, str], Field(max_length=24)]
    truncated: bool


class WorkContextData(ClosedModel):
    service: WorkService
    name: Annotated[str, Field(min_length=1, max_length=200)]
    area: Annotated[str, Field(max_length=200)]
    records: Annotated[list[WorkRecord], Field(max_length=5)]
    has_more: bool
    references: Annotated[list[Source], Field(min_length=1, max_length=5)]


class WorkContextEnvelope(ClosedModel):
    ok: Literal[True]
    data: WorkContextData
