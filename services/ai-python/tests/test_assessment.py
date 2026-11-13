"""Assessment contract/guard tests; scripted LLM does not measure semantic quality."""

import asyncio
import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from ai_buddy import create_app
from ai_buddy.assessment import AssessmentRequest, build_result, checked_judgments
from ai_buddy.config import Settings
from tests.test_app import HEADERS
from tests.test_runtime import model_response

DATASET = Path(__file__).parents[1] / "evals/knowledge-v1.json"


def case(case_id: str = "dev-complete") -> dict[str, Any]:
    return next(
        c for c in json.loads(DATASET.read_text())["cases"] if c["case_id"] == case_id
    )


def judgments(example: dict[str, Any]) -> dict[str, Any]:
    return {
        "judgments": [
            {
                "criterion_id": key,
                "reason_code": {
                    "pass": "matched",
                    "fail": "contradiction",
                    "unclear": "ambiguous",
                }[value],
                "quote": example["expected"]["quotes"].get(key),
            }
            for key, value in example["expected"]["criteria"].items()
        ]
    }


def client_for(
    monkeypatch: pytest.MonkeyPatch, outputs: list[dict[str, Any] | str], **config: Any
) -> tuple[Any, list[dict[str, Any]]]:
    calls: list[dict[str, Any]] = []
    iterator = iter(outputs)

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        output = next(iterator)
        text = (
            output
            if isinstance(output, str)
            else json.dumps(output, ensure_ascii=False)
        )
        return httpx.Response(200, json=model_response(text))

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.MockTransport(handler)
    )

    def forbidden_mcp(request: Any) -> Any:
        pytest.fail("Assessment must not connect to MCP or execute tools")

    settings = Settings(
        service_token=SecretStr("service-secret"),
        agent_enabled=True,
        ollama_model="qwen3:4b-q4_K_M",
        **config,
    )
    return create_app(settings, session_factory=forbidden_mcp).test_client(), calls


def post(client: Any, body: dict[str, Any]) -> Any:
    return client.post("/internal/v1/assessments", json=body, headers=HEADERS)


def test_versions_evidence_and_mentor_gate_come_from_code(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    example = case()
    client, calls = client_for(monkeypatch, [judgments(example)])
    assert client.get("/health/ready/assessments").json == {"ready": True}
    assert not calls
    response = post(client, example["request"])
    assert response.status_code == 200
    assessment = response.json["assessment"]
    for key in (
        "evaluation_id",
        "answer_id",
        "task_id",
        "task_version",
        "plan_version",
        "answer_version",
        "rubric_id",
        "rubric_version",
        "context_version",
    ):
        assert assessment[key] == example["request"][key]
    assert response.json["request_id"] == example["request"]["request_id"]
    assert response.json["conversation_id"] == example["request"]["conversation_id"]
    assert assessment["manual_review_required"] is True
    assert assessment["recommendation"] == "ready_for_mentor_review"
    assert assessment["method"] == "llm"
    assert (
        assessment["answer_sha256"]
        == hashlib.sha256(example["request"]["answer"].encode()).hexdigest()
    )
    assert not {"approved", "completed", "advance_stage", "score", "expected"} & set(
        assessment
    )
    for criterion in assessment["criteria"]:
        evidence = criterion["evidence"]
        assert (
            example["request"]["answer"][evidence["start"] : evidence["end"]]
            == evidence["quote"]
        )
    assert calls[0]["tools"] == []
    assert calls[0]["format"]["additionalProperties"] is False
    model_text = json.dumps(calls[0]["messages"], ensure_ascii=False)
    for key in ("request_id", "evaluation_id", "conversation_id", "answer_id"):
        assert example["request"][key] not in model_text
    assert '"reason_code"' not in calls[0]["messages"][1]["content"]
    assert example["request"]["answer"] not in caplog.text


@pytest.mark.parametrize(
    "case_id", ["dev-wrong-authority", "dev-ambiguous", "dev-optional"]
)
def test_reference_contract_and_required_criterion_aggregation(
    monkeypatch: pytest.MonkeyPatch, case_id: str
) -> None:
    example = case(case_id)
    client, _ = client_for(monkeypatch, [judgments(example)])
    result = post(client, example["request"])
    assert result.status_code == 200
    assert (
        result.json["assessment"]["recommendation"]
        == example["expected"]["recommendation"]
    )
    assert result.json["assessment"]["manual_review_required"] is True


@pytest.mark.parametrize("case_id", ["dev-empty", "dev-injection"])
def test_empty_or_injected_answer_is_unclear_without_model(
    monkeypatch: pytest.MonkeyPatch, case_id: str
) -> None:
    example = case(case_id)
    client, calls = client_for(monkeypatch, [])
    response = post(client, example["request"])
    assert response.status_code == 200
    assert not calls
    result = response.json["assessment"]
    assert result["method"] == "rule_guard"
    assert result["guard_reason"] == example["expected"]["guard_reason"]
    assert result["recommendation"] == "needs_clarification"
    assert all(
        c["verdict"] == "unclear" and c["evidence"] is None for c in result["criteria"]
    )
    assert result["manual_review_required"] is True


@pytest.mark.parametrize(
    "mutation",
    [
        "unknown",
        "duplicate",
        "missing",
        "fake_quote",
        "no_evidence",
        "unsafe_reason",
        "approval",
    ],
)
def test_invalid_model_output_is_corrected_once_or_rejected(
    monkeypatch: pytest.MonkeyPatch, mutation: str
) -> None:
    example = case()
    good = judgments(example)
    bad = copy.deepcopy(good)
    if mutation == "unknown":
        bad["judgments"][0]["criterion_id"] = "attacker-criterion"
    elif mutation == "duplicate":
        bad["judgments"][1]["criterion_id"] = bad["judgments"][0]["criterion_id"]
    elif mutation == "missing":
        bad["judgments"].pop()
    elif mutation == "fake_quote":
        bad["judgments"][0]["quote"] = "Фразы не было в ответе"
    elif mutation == "no_evidence":
        bad["judgments"][0]["quote"] = None
    elif mutation == "unsafe_reason":
        bad["judgments"][0]["reason_code"] = "approved"
    else:
        bad["approved"] = True
    client, calls = client_for(monkeypatch, [bad, good])
    response = post(client, example["request"])
    assert response.status_code == 200
    assert len(calls) == 2
    assert "attacker-criterion" not in json.dumps(
        calls[-1]["messages"], ensure_ascii=False
    )
    client, calls = client_for(monkeypatch, [bad, bad])
    response = post(client, example["request"])
    assert response.status_code == 503
    assert response.json["error"]["code"] == "AI_INVALID_RESPONSE"
    assert len(calls) == 2


@pytest.mark.parametrize(
    "mutation", ["extra", "duplicate", "no_required", "empty_expected", "snapshot_size"]
)
def test_invalid_rubric_rejected_before_model(
    monkeypatch: pytest.MonkeyPatch, mutation: str
) -> None:
    request = case()["request"]
    if mutation == "extra":
        request["approved"] = True
    elif mutation == "duplicate":
        request["criteria"][1]["id"] = request["criteria"][0]["id"]
    elif mutation == "no_required":
        for criterion in request["criteria"]:
            criterion["required"] = False
    elif mutation == "empty_expected":
        request["criteria"][0]["expected"] = " "
    else:
        request["answer"] = "я" * 4000
        request["context"] = "я" * 2000
    client, calls = client_for(monkeypatch, [])
    response = post(client, request)
    assert response.status_code == 400
    assert not calls


@pytest.mark.parametrize(
    ("data", "headers", "content_type", "status"),
    [
        ("{}", {}, "application/json", 401),
        ("{}", HEADERS, "text/plain", 415),
        ("{", HEADERS, "application/json", 400),
        ("x" * 65537, HEADERS, "application/json", 413),
    ],
)
def test_assessment_http_boundary(
    monkeypatch: pytest.MonkeyPatch,
    data: str,
    headers: dict[str, str],
    content_type: str,
    status: int,
) -> None:
    client, calls = client_for(monkeypatch, [])
    response = client.post(
        "/internal/v1/assessments",
        data=data,
        headers=headers,
        content_type=content_type,
    )
    assert response.status_code == status
    assert not calls


@pytest.mark.parametrize("failure", ["rate_limit", "timeout", "json"])
def test_failure_never_becomes_a_passing_assessment(
    monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    client, calls = client_for(monkeypatch, ["not-json", "not-json"])
    if failure != "json":

        def broken(request: httpx.Request) -> httpx.Response:
            calls.append({})
            if failure == "timeout":
                raise httpx.ReadTimeout("private-answer-or-provider-body")
            return httpx.Response(429, text="private-answer-or-provider-body")

        monkeypatch.setattr(
            httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.MockTransport(broken)
        )
    response = post(client, case()["request"])
    assert response.status_code == 503
    assert "assessment" not in response.json
    assert (
        response.json["error"]["code"]
        == {
            "rate_limit": "AI_RATE_LIMITED",
            "timeout": "AI_TIMEOUT",
            "json": "AI_INVALID_RESPONSE",
        }[failure]
    )
    assert len(calls) == (2 if failure == "json" else 1)
    assert "private-answer" not in response.text


def test_local_dataset_labels_are_consistent_but_not_human_approved() -> None:
    dataset = json.loads(DATASET.read_text())
    assert dataset["label_status"] == "draft_requires_team_review"
    assert {
        c["family"] for c in dataset["cases"] if c["split"] == "holdout"
    }.isdisjoint({c["family"] for c in dataset["cases"] if c["split"] == "development"})
    for example in dataset["cases"]:
        request = AssessmentRequest.model_validate_json(json.dumps(example["request"]))
        if example["expected"]["guard_reason"] is None:
            criteria = checked_judgments(request, json.dumps(judgments(example)))
            assert (
                build_result(request, criteria, "scripted-test").recommendation
                == example["expected"]["recommendation"]
            )


def test_total_assessment_deadline_cancels_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, calls = client_for(monkeypatch, [], turn_timeout=0.005)
    closed: list[bool] = []

    async def slow(request: httpx.Request) -> httpx.Response:
        calls.append({})
        try:
            await asyncio.sleep(1)
            return httpx.Response(200, json=model_response("late"))
        finally:
            closed.append(True)

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.MockTransport(slow)
    )
    response = post(client, case()["request"])
    assert response.status_code == 503
    assert response.json["error"]["code"] == "AI_TIMEOUT"
    assert closed == [True] and len(calls) == 1


@pytest.mark.parametrize(
    ("enabled", "model", "code"),
    [(False, "qwen3:4b-q4_K_M", "AI_UNAVAILABLE"), (True, None, "NOT_READY")],
)
def test_assessment_disabled_or_unconfigured(
    enabled: bool, model: str | None, code: str
) -> None:
    client = create_app(
        Settings(
            service_token=SecretStr("service-secret"),
            agent_enabled=enabled,
            ollama_model=model,
        )
    ).test_client()
    assert client.get("/health/ready/assessments").status_code == 503
    assert post(client, case()["request"]).json["error"]["code"] == code


def test_model_cannot_execute_a_tool_in_assessment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, calls = client_for(monkeypatch, [])

    def tool_reply(request: httpx.Request) -> httpx.Response:
        calls.append({})
        return httpx.Response(
            200,
            json=model_response(
                message={
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"function": {"name": "advance_stage", "arguments": {}}}
                    ],
                }
            ),
        )

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.MockTransport(tool_reply)
    )
    response = post(client, case()["request"])
    assert response.json["error"]["code"] == "AI_INVALID_RESPONSE"
    assert len(calls) == 2


def test_evaluator_counts_false_pass_and_keeps_gold_outside_request() -> None:
    from experiments.assessment_eval import score_case

    example = case("dev-wrong-authority")
    fake = {
        "assessment": {
            "criteria": [
                {"criterion_id": c["id"], "verdict": "pass"}
                for c in example["request"]["criteria"]
            ],
            "recommendation": "ready_for_mentor_review",
            "manual_review_required": True,
            "guard_reason": None,
        }
    }
    scores = score_case(example, 200, fake)
    assert scores["false_pass_published"] == 2
    assert scores["criterion_matches"] == 1
    assert not scores["passed"]
    assert not score_case(example, 503, {"error": {"code": "AI_TIMEOUT"}})["passed"]
