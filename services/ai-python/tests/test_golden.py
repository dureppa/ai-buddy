"""Protect the reference data from leakage, schema drift and false readiness."""

import asyncio
import json
import shutil
from pathlib import Path

import pytest

from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import CONTRACTS, Gateway
from ai_buddy.schemas import TurnRequest
from evals.golden import (
    DIRECTORY,
    Case,
    Fixture,
    audit,
    load_split,
    resolve_pointer,
    validate_case,
)
from tests.helpers import FakeSession, result, settings


def test_complete_dataset_has_separate_splits_and_no_quality_claim() -> None:
    report = audit()
    assert report == {
        "dataset_version": "agent-v1",
        "label_status": "draft_requires_team_review",
        "development": 20,
        "holdout": 10,
        "python_ready": 26,
        "blocked_by_integration": 4,
        "llm_quality": "not_measured_by_audit",
        "holdout_model_calls_by_audit": 0,
    }
    development = load_split()
    assert development.split == "development"
    assert len(development.cases) == 20
    all_cases = development.cases + load_split("holdout").cases
    for service in (
        "absences",
        "business_trips",
        "hiring",
        "dismissals",
        "consents",
        "benefits",
    ):
        assert {c.polarity for c in all_cases if c.service == service} >= {
            "positive",
            "negative",
        }
    assert not {"expected", "facts", "forbidden_claims"} & set(
        development.cases[0].input
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "extra_subject",
        "invented_source",
        "gold_as_evidence",
        "missing_evidence",
        "literal_query",
        "write_effect",
        "unimplemented_tool",
    ],
)
def test_bad_reference_cannot_pass_audit(mutation: str) -> None:
    raw = load_split().cases[0].model_dump(mode="json")
    if mutation == "extra_subject":
        raw["fixtures"][0]["arguments"]["subject_id"] = "another-person"
    elif mutation == "invented_source":
        raw["expected"]["allowed_source_ids"].append("fabricated")
    elif mutation == "gold_as_evidence":
        raw["expected"]["facts"][0]["support"] = ["/expected/facts/0/statement"]
    elif mutation == "missing_evidence":
        raw["expected"]["facts"][0]["support"] = [
            "/fixtures/0/result/data/no_such_field"
        ]
    elif mutation == "literal_query":
        raw["expected"]["calls"][0]["argument_match"] = "exact"
    elif mutation == "write_effect":
        raw["expected"]["side_effects"]["stage_transitions"] = 1
    else:
        raw["fixtures"][0]["tool"] = "advance_stage"
        raw["expected"]["calls"][0]["tool"] = "advance_stage"
    with pytest.raises((ValueError, KeyError)):
        validate_case(Case.model_validate_json(json.dumps(raw)), {"AG-02", "AG-03"})


@pytest.mark.parametrize("mutation", ["family", "hash", "review", "tool_schema"])
def test_dataset_freeze_detects_leakage_or_drift(tmp_path: Path, mutation: str) -> None:
    directory = tmp_path / "agent-v1"
    shutil.copytree(DIRECTORY, directory)
    if mutation == "family":
        p = directory / "holdout.json"
        data = json.loads(p.read_text())
        data["cases"][0]["family"] = load_split().cases[0].family
        p.write_text(json.dumps(data))
    else:
        p = directory / "manifest.json"
        data = json.loads(p.read_text())
        if mutation == "hash":
            data["files"]["development.json"] = "wrong-hash"
        elif mutation == "review":
            data["review"]["status"] = "approved_without_review"
        else:
            data["tool_schema_sha256"] = "wrong-schema"
        p.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        audit(directory)


def test_assessment_gold_obeys_required_optional_boundary() -> None:
    raw = next(
        c for c in load_split("holdout").cases if c.case_id == "hold-09"
    ).model_dump(mode="json")
    validate_case(
        Case.model_validate_json(json.dumps(raw)), {"AG-05", "AG-06", "SVC-14"}
    )
    raw["expected"]["assessment"]["recommendation"] = "needs_revision"
    with pytest.raises(ValueError, match="recommendation"):
        validate_case(
            Case.model_validate_json(json.dumps(raw)), {"AG-05", "AG-06", "SVC-14"}
        )


def test_pointer_supports_missing_value_and_escaped_property() -> None:
    assert resolve_pointer({"x/y": [{"~value": None}]}, "/x~1y/0/~0value") is None


FIXTURES = [
    (c, fixture)
    for split in ("development", "holdout")
    for c in load_split(split).cases
    if c.readiness == "python_ready" and c.mode == "chat"
    for fixture in c.fixtures
    if fixture.tool in CONTRACTS
]


@pytest.mark.parametrize(("case", "fixture"), FIXTURES, ids=[f.id for _, f in FIXTURES])
def test_reference_mcp_fixture_crosses_actual_gateway(
    case: Case, fixture: Fixture
) -> None:
    async def exercise() -> None:
        session = FakeSession()
        if fixture.transport_error:
            session.failure = ServiceError(fixture.transport_error)
        else:
            assert fixture.result is not None
            session.response = result(fixture.result, error=not fixture.result["ok"])
        gateway = Gateway(
            session, TurnRequest.model_validate_json(json.dumps(case.input)), settings()
        )
        await gateway.discover()
        failure = fixture.transport_error or (
            ErrorCode(fixture.result["error"]["code"])
            if fixture.result and not fixture.result["ok"]
            else None
        )
        if failure:
            with pytest.raises(ServiceError) as error:
                await gateway.call(fixture.tool, fixture.arguments)
            assert error.value.code == failure
        else:
            actual = await gateway.call(fixture.tool, fixture.arguments)
            assert fixture.result is not None
            assert actual == fixture.result["data"]
        assert len(session.calls) == 1

    asyncio.run(exercise())
