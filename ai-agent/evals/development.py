"""Versioned development only: no holdout loading or live model calls."""

import hashlib
import json
from pathlib import Path
from typing import Literal

from ai_buddy.assessment import AssessmentRequest
from ai_buddy.mcp_client import CONTRACTS
from ai_buddy.schemas import FailureEnvelope, TurnRequest
from evals.golden import DIRECTORY, Split, load_split, resolve_pointer

DatasetVersion = Literal["agent-v1", "agent-v2"]


def dataset_directory(version: DatasetVersion) -> Path:
    if version not in {"agent-v1", "agent-v2"}:
        raise ValueError("unknown development version")
    return DIRECTORY.with_name(version)


def runtime_schema_hash(names: list[str] | None = None) -> str:
    return hashlib.sha256(
        json.dumps(
            {
                name: {
                    "arguments": contract.arguments.model_json_schema(),
                    "result": contract.result.model_json_schema(),
                }
                for name, contract in CONTRACTS.items()
                if names is None or name in names
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode()
    ).hexdigest()


def load_development(version: DatasetVersion = "agent-v1") -> Split:
    directory = dataset_directory(version)
    dataset = load_split(directory=directory)
    if dataset.dataset_version != version or dataset.split != "development":
        raise ValueError("development version/split mismatch")
    if version == "agent-v1":
        return dataset
    manifest = json.loads((directory / "manifest.json").read_text())
    if (
        manifest["dataset_version"] != version
        or manifest["development_sha256"]
        != hashlib.sha256((directory / "development.json").read_bytes()).hexdigest()
        or manifest["tool_schema_sha256"] != runtime_schema_hash(manifest["tool_names"])
        or manifest["label_status"] != dataset.label_status
    ):
        raise ValueError("development manifest/schema drift")
    if len(dataset.cases) != manifest["case_count"] or len(
        {case.case_id for case in dataset.cases}
    ) != len(dataset.cases):
        raise ValueError("development case count/IDs mismatch")
    for case in dataset.cases:
        raw = case.model_dump(mode="json")
        expected = case.expected
        if case.readiness != "python_ready" or case.blockers:
            raise ValueError("current development uses implemented contracts only")
        if case.mode == "chat":
            TurnRequest.model_validate_json(json.dumps(case.input))
            if expected.assessment is not None:
                raise ValueError("unexpected assessment gold")
        else:
            request = AssessmentRequest.model_validate_json(json.dumps(case.input))
            if (
                case.fixtures
                or expected.assessment is None
                or set(expected.assessment.criteria)
                != {criterion.id for criterion in request.criteria}
            ):
                raise ValueError("assessment gold/rubric mismatch")
        if (
            (expected.http_status == 503) != (expected.outcome == "service_error")
            or expected.error_code != case.fault
            or expected.state_before != expected.state_after
            or expected.side_effects.get("corporate_writes") != 0
            or expected.side_effects.get("stage_transitions") != 0
        ):
            raise ValueError("inconsistent outcome or external effects")
        fixtures = {fixture.tool for fixture in case.fixtures}
        if (
            fixtures != {call.tool for call in expected.calls}
            or not set(expected.ordered_tools) <= fixtures
        ):
            raise ValueError("fixture/call dependency mismatch")
        sources: set[str] = set()
        for fixture in case.fixtures:
            contract = CONTRACTS[fixture.tool]
            contract.arguments.model_validate(fixture.arguments)
            if fixture.result is not None:
                schema = (
                    contract.result if fixture.result.get("ok") else FailureEnvelope
                )
                schema.model_validate(fixture.result)
                if fixture.result.get("ok"):
                    data = fixture.result["data"]
                    records = (
                        [document["source"] for document in data["documents"]]
                        if fixture.tool == "search_knowledge"
                        else data["references"]
                    )
                    sources.update(source["id"] for source in records)
        if (
            not set(expected.required_source_ids) <= set(expected.allowed_source_ids)
            or not set(expected.allowed_source_ids) <= sources
            or set(expected.forbidden_source_ids) & set(expected.allowed_source_ids)
        ):
            raise ValueError("invalid citation allowlist")
        for call in expected.calls:
            CONTRACTS[call.tool].arguments.model_validate(call.arguments_example)
            if (
                call.min_calls > call.max_calls
                or (
                    (call.tool == "search_knowledge")
                    != (call.argument_match == "semantic_query")
                )
                or (call.tool == "search_knowledge" and not call.query_intent)
            ):
                raise ValueError("invalid call rule")
        for fact in expected.facts:
            for pointer in fact.support:
                if pointer.startswith("policy:"):
                    if pointer.removeprefix("policy:") not in case.requirements:
                        raise ValueError("unrelated evidence policy")
                elif pointer.startswith(("/fixtures/", "/input/")):
                    resolve_pointer(raw, pointer)
                else:
                    raise ValueError("gold cannot support itself")
    return dataset
