"""Current dataset integrity, version binding and trajectory regressions, offline."""

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from ai_buddy.mcp_client import CONTRACTS
from evals import development, harness
from evals.development import load_development
from evals.harness import FixtureBackend, structural_checks
from evals.review import Review, reviewed_report
from tests.test_eval_review import sample


def test_current_cases_are_executable_and_cover_current_contracts() -> None:
    dataset = load_development("agent-v2")
    assert len(dataset.cases) == 25
    assert {f.tool for c in dataset.cases for f in c.fixtures} <= set(CONTRACTS)
    for case in dataset.cases:
        FixtureBackend(case)
        assert case.readiness == "python_ready"
    legacy = load_development()
    assert len(legacy.cases) == 20
    assert sum(c.readiness == "blocked_by_integration" for c in legacy.cases) == 2


@pytest.mark.parametrize("version", ["holdout", "../agent-v1", "agent-v3"])
def test_arbitrary_versions_do_not_read_files(
    version: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        Path, "read_text", lambda *a, **k: pytest.fail("unexpected read")
    )
    with pytest.raises(ValueError, match="unknown development"):
        load_development(version)


@pytest.mark.parametrize(
    "mutation",
    [
        "hash",
        "schema",
        "split",
        "version",
        "duplicate",
        "outcome",
        "source",
        "evidence",
        "rubric",
        "calls",
    ],
)
def test_current_dataset_rejects_drift_and_invalid_expectations(
    mutation: str, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    original = development.dataset_directory("agent-v2")
    data = json.loads((original / "development.json").read_text())
    manifest = json.loads((original / "manifest.json").read_text())
    c = data["cases"][0]
    if mutation == "schema":
        manifest["tool_schema_sha256"] = "wrong"
    elif mutation == "split":
        data["split"] = "holdout"
    elif mutation == "version":
        data["dataset_version"] = "agent-v1"
    elif mutation == "duplicate":
        data["cases"][1]["case_id"] = c["case_id"]
    elif mutation == "outcome":
        c["expected"]["side_effects"]["stage_transitions"] = 1
    elif mutation == "source":
        c["expected"]["allowed_source_ids"].append("invented")
    elif mutation == "evidence":
        c["expected"]["facts"][0]["support"] = ["/expected/facts/0"]
    elif mutation == "rubric":
        data["cases"][18]["expected"]["assessment"]["criteria"] = {}
    elif mutation == "calls":
        c["expected"]["calls"] = []
    dest = tmp_path / "agent-v2"
    dest.mkdir()
    raw = json.dumps(data).encode()
    (dest / "development.json").write_bytes(raw)
    if mutation != "hash":
        manifest["development_sha256"] = hashlib.sha256(raw).hexdigest()
    (dest / "manifest.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(development, "DIRECTORY", tmp_path / "agent-v1")
    with pytest.raises(ValueError):
        load_development("agent-v2")


def test_distinct_arguments_have_independent_counts_and_exact_match() -> None:
    case = load_development("agent-v2").cases[24]
    calls: list[dict[str, Any]] = [
        {
            "name": f.tool,
            "arguments": CONTRACTS[f.tool]
            .arguments.model_validate(f.arguments)
            .model_dump(),
            "result": f.result,
        }
        for f in case.fixtures
    ]
    checks = structural_checks(case, 200, {}, calls)
    assert checks["call_counts"] and checks["exact_arguments"]
    calls[1]["arguments"]["issue_id"] = "44444444-4444-4444-8444-444444444444"
    assert not structural_checks(case, 200, {}, calls)["exact_arguments"]
    calls = [copy.deepcopy(calls[0])] * 3
    assert not structural_checks(case, 200, {}, calls)["call_counts"]


def test_report_and_review_are_bound_to_selected_development(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "synthetic-key")
    monkeypatch.setattr(
        httpx, "Client", lambda **kw: pytest.fail("unexpected preflight")
    )
    monkeypatch.setattr(
        harness,
        "execute_case",
        lambda c, s: {
            "case_id": c.case_id,
            "execution": "executed",
            "structural_pass": False,
        },
    )
    p = harness.main(
        "mock",
        tmp_path,
        provider="deepseek",
        allow_live_llm=True,
        dataset_version="agent-v2",
    )
    report = json.loads(p.read_text())
    assert report["dataset_version"] == "agent-v2" and len(report["runs"]) == 25
    assert (
        report["dataset_tool_schema_sha256"]
        == json.loads(
            (development.dataset_directory("agent-v2") / "manifest.json").read_text()
        )["tool_schema_sha256"]
    )
    assert report["holdout_executed"] is False
    assert not (development.dataset_directory("agent-v2") / "holdout.json").exists()
    old, raw = sample()
    old.update(dataset_version="agent-v2", dataset_sha256="wrong")
    with pytest.raises(ValueError, match="dataset hash"):
        reviewed_report(old, Review.model_validate(raw))
