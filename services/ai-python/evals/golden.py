"""Offline dataset contract audit. No model calls and no quality score."""

import hashlib
import json
import re
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from ai_buddy.assessment import AssessmentRequest, Recommendation, Verdict
from ai_buddy.errors import ErrorCode
from ai_buddy.mcp_client import CONTRACTS
from ai_buddy.schemas import ClosedModel, FailureEnvelope, TurnRequest

DIRECTORY = Path(__file__).with_name("agent-v1")
SERVICES = {
    "absences",
    "business_trips",
    "hiring",
    "dismissals",
    "consents",
    "benefits",
}
PROPOSED_TOOLS = {"get_onboarding_progress", "get_task_context", "get_task_evidence"}
Nonempty = Annotated[str, Field(min_length=1)]


class Fact(ClosedModel):
    statement: Nonempty
    support: Annotated[list[Nonempty], Field(min_length=1)]


class Fixture(ClosedModel):
    id: Nonempty
    tool: Nonempty
    arguments: dict[str, Any]
    result: dict[str, Any] | None
    transport_error: ErrorCode | None

    @model_validator(mode="after")
    def one_result(self) -> "Fixture":
        if (self.result is None) == (self.transport_error is None):
            raise ValueError("fixture needs exactly one result or transport error")
        return self


class CallRule(ClosedModel):
    tool: Nonempty
    arguments_example: dict[str, Any]
    argument_match: Literal["exact", "semantic_query"]
    query_intent: str | None
    min_calls: Annotated[int, Field(ge=0, le=6)]
    max_calls: Annotated[int, Field(ge=1, le=6)]


class AssessmentGold(ClosedModel):
    criteria: dict[str, Verdict]
    recommendation: Recommendation
    manual_review_required: Literal[True]
    method: Literal["llm", "rule_guard"]
    guard_reason: Literal["untrusted_content", "empty_answer"] | None


class Expected(ClosedModel):
    outcome: Literal[
        "answer", "clarify", "abstain", "blocked_content", "service_error", "assessment"
    ]
    http_status: Literal[200, 503]
    error_code: ErrorCode | None
    facts: Annotated[list[Fact], Field(min_length=1)]
    forbidden_claims: Annotated[list[Nonempty], Field(min_length=1)]
    calls: list[CallRule]
    ordered_tools: list[str]
    allowed_source_ids: list[str]
    required_source_ids: list[str]
    forbidden_source_ids: list[str]
    side_effects: dict[str, Any]
    state_before: dict[str, Any]
    state_after: dict[str, Any]
    assessment: AssessmentGold | None


class Case(ClosedModel):
    case_id: Nonempty
    title: Nonempty
    family: Nonempty
    mode: Literal["chat", "assessment"]
    service: str | None
    polarity: Literal["positive", "negative"]
    requirements: Annotated[list[Nonempty], Field(min_length=1)]
    readiness: Literal["python_ready", "blocked_by_integration"]
    blockers: list[str]
    context: dict[str, str | list[str]]
    input: dict[str, Any]
    fixtures: list[Fixture]
    fault: ErrorCode | None
    expected: Expected


class Split(ClosedModel):
    dataset_version: Literal["agent-v1"]
    split: Literal["development", "holdout"]
    label_status: Literal["draft_requires_team_review"]
    cases: list[Case]


def load_split(
    split: Literal["development", "holdout"] = "development",
    *,
    directory: Path = DIRECTORY,
) -> Split:
    return Split.model_validate_json((directory / f"{split}.json").read_text())


def resolve_pointer(data: Any, pointer: str) -> Any:
    """Resolve RFC 6901-style paths, including null as legitimate evidence."""
    if not pointer.startswith("/"):
        raise ValueError("not a JSON pointer")
    for key in pointer[1:].split("/"):
        key = key.replace("~1", "/").replace("~0", "~")
        data = data[int(key)] if isinstance(data, list) else data[key]
    return data


def validate_case(case: Case, requirements: set[str]) -> None:
    if case.service is not None and case.service not in SERVICES:
        raise ValueError("unknown corporate service")
    if set(case.requirements) - requirements:
        raise ValueError("unknown requirement")
    if (
        not set(case.context)
        >= {
            "profile_id",
            "role",
            "stage",
            "permissions",
            "corpus_version",
            "plan_version",
            "data_origin",
        }
        or case.context["data_origin"] != "synthetic_fixture_not_avito_policy"
    ):
        raise ValueError("missing context/provenance")
    if (case.readiness == "blocked_by_integration") != bool(case.blockers):
        raise ValueError("inconsistent blockers")
    expected = case.expected
    if (expected.http_status == 503) != (expected.outcome == "service_error"):
        raise ValueError("error status mismatch")
    if (expected.error_code is not None) != (expected.http_status == 503):
        raise ValueError("error code mismatch")
    if expected.error_code != case.fault:
        raise ValueError("fault must match expected error")
    if not set(expected.required_source_ids) <= set(expected.allowed_source_ids):
        raise ValueError("required citation is not allowed")
    if set(expected.allowed_source_ids) & set(expected.forbidden_source_ids):
        raise ValueError("forbidden citation is allowed")
    effects = expected.side_effects
    if (
        effects
        != {
            "corporate_writes": 0,
            "stage_transitions": 0,
            "verification": "external_state_required"
            if case.readiness == "blocked_by_integration"
            else "read_only_python_trace",
        }
        or expected.state_before != expected.state_after
    ):
        raise ValueError("agent may not write or advance stages")
    raw = case.model_dump(mode="json")
    for fact in expected.facts:
        for support in fact.support:
            if support.startswith("policy:"):
                if support.removeprefix("policy:") not in requirements:
                    raise ValueError("unknown evidence policy")
            else:
                if not support.startswith(("/fixtures/", "/input/")):
                    raise ValueError("evidence must not reference gold expectations")
                resolve_pointer(raw, support)
    if len({f.id for f in case.fixtures}) != len(case.fixtures):
        raise ValueError("duplicate fixture IDs")
    fixture_tools = {f.tool for f in case.fixtures}
    if {c.tool for c in expected.calls} != fixture_tools:
        raise ValueError("call/fixture set mismatch")
    if not set(expected.ordered_tools) <= fixture_tools:
        raise ValueError("invalid tool dependency")
    allowed = (
        set(CONTRACTS)
        if case.readiness == "python_ready"
        else set(CONTRACTS) | PROPOSED_TOOLS
    )
    for fixture in case.fixtures:
        if fixture.tool not in allowed:
            raise ValueError("unimplemented or forbidden tool")
        if fixture.tool in CONTRACTS and (
            case.readiness == "python_ready" or fixture.tool not in PROPOSED_TOOLS
        ):
            contract = CONTRACTS[fixture.tool]
            contract.arguments.model_validate_json(json.dumps(fixture.arguments))
            if fixture.result is not None:
                schema = (
                    contract.result if fixture.result.get("ok") else FailureEnvelope
                )
                schema.model_validate_json(json.dumps(fixture.result))
    source_ids = {
        source["id"]
        for fixture in case.fixtures
        if fixture.result and fixture.result.get("ok")
        for source in (
            [d["source"] for d in fixture.result["data"]["documents"]]
            if fixture.tool == "search_knowledge"
            else fixture.result["data"]["references"]
            if fixture.tool == "get_team_context"
            else []
        )
    }
    if not set(expected.allowed_source_ids) <= source_ids:
        raise ValueError("allowed citation has no fixture source")
    for call in expected.calls:
        if call.min_calls > call.max_calls:
            raise ValueError("invalid call budget")
        if call.tool == "search_knowledge":
            if call.argument_match != "semantic_query" or not call.query_intent:
                raise ValueError("search needs semantic intent, not literal query")
        elif call.argument_match != "exact" or call.query_intent is not None:
            raise ValueError("non-search arguments must be exact")
        if call.tool in CONTRACTS:
            CONTRACTS[call.tool].arguments.model_validate_json(
                json.dumps(call.arguments_example)
            )
    if case.mode == "chat":
        TurnRequest.model_validate_json(json.dumps(case.input))
        if expected.assessment is not None or expected.outcome == "assessment":
            raise ValueError("chat must not contain assessment gold")
    else:
        request = AssessmentRequest.model_validate_json(json.dumps(case.input))
        gold = expected.assessment
        if gold is None or expected.outcome != "assessment" or case.fixtures:
            raise ValueError("assessment requires gold and no tools")
        if set(gold.criteria) != {c.id for c in request.criteria}:
            raise ValueError("rubric/gold IDs mismatch")
        required = {gold.criteria[c.id] for c in request.criteria if c.required}
        wanted = (
            "needs_revision"
            if "fail" in required
            else "needs_clarification"
            if "unclear" in required
            else "ready_for_mentor_review"
        )
        if gold.recommendation != wanted:
            raise ValueError("gold recommendation conflicts with required criteria")
        if (gold.method == "rule_guard") != (gold.guard_reason is not None):
            raise ValueError("guard method mismatch")


def audit(directory: Path = DIRECTORY) -> dict[str, Any]:
    repo = Path(__file__).resolve().parents[3]
    text = "\n".join(
        p.read_text()
        for p in (repo / "openspec/changes/implement-python-agent/specs").glob(
            "*/spec.md"
        )
    )
    requirements = set(re.findall(r"### Requirement: ([A-Z]+-\d+)", text))
    manifest = json.loads((directory / "manifest.json").read_text())
    if (
        manifest["dataset_version"] != "agent-v1"
        or manifest["label_status"] != "draft_requires_team_review"
        or manifest["review"]["status"] != "pending_team_and_mentor"
    ):
        raise ValueError("manifest review status requires explicit migration")
    splits = [
        load_split(name, directory=directory) for name in ("development", "holdout")
    ]
    all_cases = [c for s in splits for c in s.cases]
    if [len(s.cases) for s in splits] != [20, 10]:
        raise ValueError("expected exactly 20 development and 10 holdout")
    if [s.split for s in splits] != ["development", "holdout"]:
        raise ValueError("split file label mismatch")
    if len({c.case_id for c in all_cases}) != 30:
        raise ValueError("duplicate case IDs")
    if {c.family for c in splits[0].cases} & {c.family for c in splits[1].cases}:
        raise ValueError("scenario family leakage")
    signatures = [
        json.dumps(
            {
                k: v
                for k, v in c.input.items()
                if k
                not in {
                    "request_id",
                    "conversation_id",
                    "delegation_token",
                    "evaluation_id",
                    "answer_id",
                }
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        for c in all_cases
    ]
    if len(set(signatures)) != 30:
        raise ValueError("duplicate stimuli")
    for s in splits:
        actual = hashlib.sha256(
            (directory / f"{s.split}.json").read_bytes()
        ).hexdigest()
        if manifest["files"][s.split + ".json"] != actual:
            raise ValueError("dataset hash mismatch")
    for case in all_cases:
        validate_case(case, requirements)
    if manifest["tool_schema_sha256"] != tool_schema_hash():
        raise ValueError("tool schema drift requires dataset review")
    return {
        "dataset_version": "agent-v1",
        "label_status": "draft_requires_team_review",
        "development": 20,
        "holdout": 10,
        "python_ready": sum(c.readiness == "python_ready" for c in all_cases),
        "blocked_by_integration": sum(
            c.readiness == "blocked_by_integration" for c in all_cases
        ),
        "llm_quality": "not_measured_by_audit",
        "holdout_model_calls_by_audit": 0,
    }


def tool_schema_hash() -> str:
    schemas = {
        n: {
            "arguments": c.arguments.model_json_schema(),
            "result": c.result.model_json_schema(),
        }
        for n, c in CONTRACTS.items()
        # agent-v1 freezes the original read-only slice. Its four integration
        # cases remain blocked until their richer proposed stage contract is reviewed.
        if n in {"search_knowledge", "get_team_context"}
    }
    return hashlib.sha256(
        json.dumps(schemas, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


if __name__ == "__main__":
    print(json.dumps(audit(), ensure_ascii=False, indent=2))
