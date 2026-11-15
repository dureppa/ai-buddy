"""Live comparison against draft labels; never sends gold verdicts to the assessor."""

import argparse
import hashlib
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from pydantic import SecretStr

from ai_buddy import create_app
from ai_buddy.assessment import PROMPT, PROMPT_VERSION
from ai_buddy.config import Settings

DATASET = Path(__file__).parents[1] / "evals/knowledge-v1.json"


def score_case(
    case: dict[str, Any], status: int, response: dict[str, Any]
) -> dict[str, Any]:
    expected = case["expected"]
    actual = response.get("assessment", {})
    verdicts = {c["criterion_id"]: c["verdict"] for c in actual.get("criteria", [])}
    matches = sum(
        verdicts.get(key) == value for key, value in expected["criteria"].items()
    )
    false_pass = sum(
        verdicts.get(key) == "pass" and value != "pass"
        for key, value in expected["criteria"].items()
    )
    checks = {
        "http_ok": status == 200,
        "criteria_match": verdicts == expected["criteria"],
        "recommendation_match": actual.get("recommendation")
        == expected["recommendation"],
        "guard_match": actual.get("guard_reason") == expected["guard_reason"],
        "mentor_review_required": actual.get("manual_review_required") is True,
        "no_approval_fields": not (
            {"approved", "completed", "advance_stage"} & set(actual)
        ),
    }
    return {
        "checks": checks,
        "passed": all(checks.values()),
        "criterion_matches": matches,
        "criterion_total": len(expected["criteria"]),
        "false_pass_published": false_pass,
    }


def main(split: str = "development") -> None:
    dataset = json.loads(DATASET.read_text())
    settings = Settings(
        service_token=SecretStr("synthetic-assessment-only"),
        agent_enabled=True,
        ollama_model="qwen3:4b-q4_K_M",
    )
    with httpx.Client(timeout=60, trust_env=False) as transport_client:
        tags = transport_client.get(settings.ollama_url + "/api/tags").json()["models"]
        selected = next(tag for tag in tags if tag["name"] == settings.ollama_model)
        start = time.monotonic()
        warmup = transport_client.post(
            settings.ollama_url + "/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": [{"role": "user", "content": "Ответь ОК."}],
                "think": False,
                "stream": False,
                "options": {"num_ctx": 4096, "num_predict": 16},
            },
        )
        warmup.raise_for_status()
    report: dict[str, Any] = {
        "dataset_version": dataset["version"],
        "label_status": dataset["label_status"],
        "dataset_sha256": hashlib.sha256(DATASET.read_bytes()).hexdigest(),
        "split": split,
        "prompt_version": PROMPT_VERSION,
        "prompt": PROMPT,
        "prompt_sha256": hashlib.sha256(PROMPT.encode()).hexdigest(),
        "model": selected,
        "warmup_seconds": round(time.monotonic() - start, 3),
        "scope": "Real Flask assessment endpoint with local Ollama, synthetic snapshots; no Go/MCP/persistence/approval.",
        "runs": [],
        "complete": False,
    }
    client = create_app(settings).test_client()
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    output = Path(__file__).with_name(
        f"assessment-{split}-{PROMPT_VERSION}-{stamp}.json"
    )
    for case in (c for c in dataset["cases"] if c["split"] == split):
        start = time.monotonic()
        response = client.post(
            "/internal/v1/assessments",
            json=case["request"],
            headers={"Authorization": "Bearer synthetic-assessment-only"},
        )
        data = response.get_json()
        scores = score_case(case, response.status_code, data)
        report["runs"].append(
            {
                "case_id": case["case_id"],
                "status": response.status_code,
                "seconds": round(time.monotonic() - start, 3),
                "response": data,
                **scores,
            }
        )
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(
            case["case_id"],
            response.status_code,
            scores["passed"],
            f"criteria={scores['criterion_matches']}/{scores['criterion_total']}",
            flush=True,
        )
    report["complete"] = True
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved {output}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--split", choices=["development", "holdout"], default="development"
    )
    main(parser.parse_args().split)
