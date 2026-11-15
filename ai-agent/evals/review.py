"""Bind explicit factual/constraint review to immutable development responses."""

import argparse
import hashlib
import json
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import Field

from ai_buddy.schemas import ClosedModel
from evals.golden import load_split, resolve_pointer


class FactRating(ClosedModel):
    index: int
    verdict: Literal["supported", "missing", "contradicted", "unclear"]
    quote: str | None
    basis: list[str]
    explanation: Annotated[str, Field(min_length=1)]


class ConstraintRating(ClosedModel):
    index: int
    respected: bool
    quote: str | None
    explanation: Annotated[str, Field(min_length=1)]


class QueryRating(ClosedModel):
    call_index: int
    relevant: bool
    explanation: Annotated[str, Field(min_length=1)]


class CaseReview(ClosedModel):
    case_id: str
    response_sha256: str
    facts: list[FactRating]
    constraints: list[ConstraintRating]
    queries: list[QueryRating]
    unsupported_claims: list[str]
    additional_claims_checked: Literal[True]


class Review(ClosedModel):
    version: Literal["agent-review-v1"]
    report_sha256: str
    reviewer: Literal["codex_assisted", "human"]
    reviewer_name: Annotated[str, Field(min_length=1)]
    cases: list[CaseReview]


def reviewed_report(report: dict[str, Any], review: Review) -> dict[str, Any]:
    if report["split"] != "development" or not report["complete"]:
        raise ValueError("only complete development reports may be reviewed")
    cases = {c.case_id: c for c in load_split().cases}
    if len({c.case_id for c in review.cases}) != len(review.cases):
        raise ValueError("duplicate review")
    runs = {r["case_id"]: r for r in report["runs"]}
    for item in review.cases:
        run = runs[item.case_id]
        case = cases[item.case_id]
        if (
            run["execution"] != "executed"
            or item.response_sha256 != run["response_sha256"]
        ):
            raise ValueError("review/response mismatch")
        actual_hash = hashlib.sha256(
            json.dumps(run["response"], ensure_ascii=False, sort_keys=True).encode()
        ).hexdigest()
        if actual_hash != run["response_sha256"]:
            raise ValueError("edited response")
        haystack = (
            run["response"].get("reply", {}).get("text", "")
            + "\n"
            + json.dumps(run["response"], ensure_ascii=False, sort_keys=True)
        )
        if sorted(f.index for f in item.facts) != list(range(len(case.expected.facts))):
            raise ValueError("every expected fact needs one rating")
        if sorted(c.index for c in item.constraints) != list(
            range(len(case.expected.forbidden_claims))
        ):
            raise ValueError("every constraint needs one rating")
        query_indices = [
            i
            for i, c in enumerate(run["actual_calls"])
            if c["name"] == "search_knowledge"
        ]
        if sorted(q.call_index for q in item.queries) != query_indices:
            raise ValueError("every actual search intent needs review")
        for f in item.facts:
            if f.quote and f.quote not in haystack:
                raise ValueError("review quote not in response")
            if f.verdict == "supported":
                if not f.quote or not f.basis:
                    raise ValueError("supported fact needs quote and evidence")
                for pointer in f.basis:
                    if pointer.startswith("policy:"):
                        if pointer not in case.expected.facts[f.index].support:
                            raise ValueError("unrelated policy")
                    elif (
                        pointer.startswith("/actual_calls/")
                        or pointer.startswith("/response/")
                        and (
                            case.mode == "assessment"
                            or case.expected.outcome == "service_error"
                        )
                    ):
                        resolve_pointer(run, pointer)
                    else:
                        raise ValueError("review must use actually observed evidence")
        for c in item.constraints:
            if c.quote and c.quote not in haystack:
                raise ValueError("constraint quote missing")
        if any(quote not in haystack for quote in item.unsupported_claims):
            raise ValueError("additional claim quote missing")
        semantic = (
            all(f.verdict == "supported" for f in item.facts)
            and all(c.respected for c in item.constraints)
            and all(q.relevant for q in item.queries)
            and not item.unsupported_claims
        )
        run["semantic_review"] = item.model_dump(mode="json")
        run["semantic"] = "reviewed"
        run["reviewer"] = review.reviewer
        run["assisted_passed"] = run["structural_pass"] and semantic
        run["passed"] = run["assisted_passed"] if review.reviewer == "human" else None
    report["reviewer"] = {
        "type": review.reviewer,
        "name": review.reviewer_name,
        "calibrated_independent_judge": False,
    }
    report["summary"]["semantic_assessed"] = len(review.cases)
    report["summary"]["assisted_review_pass"] = sum(
        r.get("assisted_passed", False) for r in report["runs"]
    )
    report["summary"]["human_reviewed"] = (
        len(review.cases) if review.reviewer == "human" else 0
    )
    report["release_accepted"] = False
    return report


def apply_review(report_path: Path, review_path: Path) -> Path:
    raw = report_path.read_bytes()
    review = Review.model_validate_json(review_path.read_text())
    if review.report_sha256 != hashlib.sha256(raw).hexdigest():
        raise ValueError("report hash mismatch")
    report = json.loads(raw)
    result = reviewed_report(report, review)
    result["review_source_sha256"] = hashlib.sha256(
        review_path.read_bytes()
    ).hexdigest()
    path = report_path.with_name("reviewed-" + report_path.name)
    if path.exists():
        raise ValueError("never overwrite an existing reviewed report")
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("review", type=Path)
    args = parser.parse_args()
    print(apply_review(args.report, args.review))
