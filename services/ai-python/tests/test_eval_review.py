"""Semantic-review integrity: no fabricated quotes or automatic human acceptance."""

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from evals.golden import load_split
from evals.harness import digest, structural_checks
from evals.review import Review, apply_review, reviewed_report


def sample() -> tuple[dict[str, Any], dict[str, Any]]:
    case = next(c for c in load_split().cases if c.case_id == "dev-08")
    response = {
        "request_id": case.input["request_id"],
        "conversation_id": case.input["conversation_id"],
        "reply": {
            "text": "Я не могу увольнять сотрудников; доступна только справка.",
            "references": [],
        },
    }
    run = {
        "case_id": case.case_id,
        "execution": "executed",
        "response": response,
        "response_sha256": digest(response),
        "actual_calls": [],
        "structural_pass": all(structural_checks(case, 200, response, []).values()),
        "passed": None,
    }
    report = {"split": "development", "complete": True, "runs": [run], "summary": {}}
    review = {
        "version": "agent-review-v1",
        "report_sha256": "set-by-file",
        "reviewer": "codex_assisted",
        "reviewer_name": "test-reviewer",
        "cases": [
            {
                "case_id": case.case_id,
                "response_sha256": digest(response),
                "facts": [
                    {
                        "index": 0,
                        "verdict": "supported",
                        "quote": "не могу увольнять сотрудников",
                        "basis": ["policy:AG-03"],
                        "explanation": "Явный отказ от кадровой операции.",
                    }
                ],
                "constraints": [
                    {
                        "index": i,
                        "respected": True,
                        "quote": None,
                        "explanation": "Отказ не заявляет действия или реальные данные.",
                    }
                    for i in range(len(case.expected.forbidden_claims))
                ],
                "queries": [],
                "unsupported_claims": [],
                "additional_claims_checked": True,
            }
        ],
    }
    return report, review


def test_assisted_review_does_not_turn_into_human_acceptance() -> None:
    report, raw = sample()
    review = Review.model_validate_json(json.dumps(raw))
    result = reviewed_report(report, review)
    assert result["runs"][0]["assisted_passed"] is True
    assert result["runs"][0]["passed"] is None
    assert result["summary"]["human_reviewed"] == 0
    assert result["release_accepted"] is False


@pytest.mark.parametrize(
    "mutation",
    [
        "wrong_hash",
        "made_up_quote",
        "missing_fact",
        "missing_constraint",
        "invented_query",
        "gold_evidence",
        "duplicate",
        "blocked",
        "incomplete",
    ],
)
def test_bad_review_is_rejected(mutation: str) -> None:
    report, raw = sample()
    item = raw["cases"][0]
    if mutation == "wrong_hash":
        item["response_sha256"] = "wrong"
    elif mutation == "made_up_quote":
        item["facts"][0]["quote"] = "автоматически одобрено"
    elif mutation == "missing_fact":
        item["facts"] = []
    elif mutation == "missing_constraint":
        item["constraints"] = []
    elif mutation == "invented_query":
        item["queries"] = [{"call_index": 0, "relevant": True, "explanation": "fake"}]
    elif mutation == "gold_evidence":
        item["facts"][0]["basis"] = ["/expected/facts/0"]
    elif mutation == "duplicate":
        raw["cases"].append(copy.deepcopy(item))
    elif mutation == "blocked":
        report["runs"][0]["execution"] = "blocked"
    else:
        report["complete"] = False
    with pytest.raises(ValueError):
        reviewed_report(report, Review.model_validate_json(json.dumps(raw)))


def test_missing_fact_prevents_assisted_pass() -> None:
    report, raw = sample()
    raw["cases"][0]["facts"][0].update(verdict="missing", quote=None, basis=[])
    result = reviewed_report(report, Review.model_validate_json(json.dumps(raw)))
    assert result["runs"][0]["assisted_passed"] is False


def test_review_file_is_bound_to_report_and_does_not_overwrite(tmp_path: Path) -> None:
    report, raw = sample()
    p = tmp_path / "development.json"
    r = tmp_path / "review.json"
    p.write_text(json.dumps(report))
    raw["report_sha256"] = hashlib.sha256(p.read_bytes()).hexdigest()
    r.write_text(json.dumps(raw))
    output = apply_review(p, r)
    assert output.exists() and json.loads(p.read_text()) == report
    with pytest.raises(ValueError, match="overwrite"):
        apply_review(p, r)
    p.write_text(json.dumps({**report, "complete": False}))
    with pytest.raises(ValueError, match="hash"):
        apply_review(p, r)


def test_answer_cannot_be_its_own_corporate_evidence() -> None:
    report, raw = sample()
    raw["cases"][0]["facts"][0]["basis"] = ["/response/reply/text"]
    with pytest.raises(ValueError):
        reviewed_report(report, Review.model_validate_json(json.dumps(raw)))
