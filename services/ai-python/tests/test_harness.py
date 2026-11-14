"""Harness boundaries and false-success regressions, no real LLM calls."""

import json
from pathlib import Path
from typing import Any, Self

import httpx
import pytest
from pydantic import SecretStr

from ai_buddy.config import Settings
from evals.golden import load_split
from evals.harness import execute_case, structural_checks
from tests.test_runtime import model_response


def test_actual_flask_mcp_calls_and_no_gold_in_model_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = load_split().cases[0]
    assert case.fixtures[0].result is not None
    source = case.fixtures[0].result["data"]["documents"][0]["source"]["id"]
    messages = []

    def model(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)
        messages.append(data)
        if len(messages) == 1:
            return httpx.Response(
                200,
                json=model_response(
                    message={
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "function": {
                                    "name": "search_knowledge",
                                    "arguments": {
                                        "query": "оформить отсутствие",
                                        "limit": 3,
                                    },
                                }
                            }
                        ],
                    }
                ),
            )
        return httpx.Response(
            200,
            json=model_response(
                "Учебный сервис: нужны тип и даты, затем отдельное подтверждение. Заявка ожидает решения. ["
                + source
                + "]"
            ),
        )

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kw: httpx.MockTransport(model)
    )
    result = execute_case(
        case,
        Settings(
            service_token=SecretStr("synthetic"),
            agent_enabled=True,
            ollama_model="test-model",
            mcp_url="http://127.0.0.1/mcp",
        ),
    )
    assert result["structural_pass"] is True, result
    assert result["passed"] is None and result["semantic"] == "unassessed"
    assert result["actual_calls"][0]["arguments"]["query"] == "оформить отсутствие"
    assert len(result["model_calls"]) == 2
    assert "forbidden_claims" not in json.dumps(messages)
    assert "query_intent" not in json.dumps(messages)


def test_fixture_sources_are_not_evidence_until_really_called() -> None:
    case = load_split().cases[0]
    assert case.fixtures[0].result is not None
    source = case.fixtures[0].result["data"]["documents"][0]["source"]
    response = {
        "request_id": case.input["request_id"],
        "conversation_id": case.input["conversation_id"],
        "reply": {
            "text": "[" + source["id"] + "]",
            "references": [{"url": source["url"], "title": "Demo"}],
        },
    }
    checks = structural_checks(case, 200, response, [])
    assert not checks["citations"] and not checks["call_counts"]
    assert not checks["reference_urls"]


def test_blocked_case_never_calls_model_or_tools() -> None:
    case = next(
        c for c in load_split().cases if c.readiness == "blocked_by_integration"
    )
    result = execute_case(case, Settings())
    assert result["execution"] == "blocked" and result["passed"] is None


def test_expected_and_accidental_failures_are_different() -> None:
    cases = load_split().cases
    normal = cases[0]
    expected = next(c for c in cases if c.case_id == "dev-16")
    response = {"error": {"code": "MCP_TIMEOUT"}}
    calls = [
        {
            "name": "search_knowledge",
            "arguments": {"query": "статус командировки", "limit": 3},
        }
    ]
    assert not structural_checks(normal, 503, response, calls)["http_status"]
    assert all(structural_checks(expected, 503, response, calls).values())


@pytest.mark.parametrize(
    ("case_id", "tool"),
    [("dev-06", "search_knowledge"), ("dev-16", "search_knowledge")],
)
def test_server_domain_failure_survives_sdk_context_cleanup(
    monkeypatch: pytest.MonkeyPatch, case_id: str, tool: str
) -> None:
    case = next(c for c in load_split().cases if c.case_id == case_id)

    def model(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=model_response(
                message={
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "function": {
                                "name": tool,
                                "arguments": {
                                    "query": "инструкция для стажёра",
                                    "limit": 3,
                                },
                            }
                        }
                    ],
                }
            ),
        )

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kw: httpx.MockTransport(model)
    )
    result = execute_case(
        case,
        Settings(
            service_token=SecretStr("synthetic"),
            agent_enabled=True,
            ollama_model="test-model",
            mcp_url="http://127.0.0.1/mcp",
        ),
    )
    assert case.fault is not None
    assert result["response"]["error"]["code"] == case.fault.value
    assert result["structural_pass"] is True


@pytest.mark.parametrize("interrupt", [False, True])
def test_cli_keeps_complete_and_interrupted_reports_separate(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, interrupt: bool
) -> None:
    from evals import harness

    class Client:
        def __init__(self, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def get(self, url: str) -> httpx.Response:
            return httpx.Response(
                200,
                json={"models": [{"name": "test-model", "digest": "test-digest"}]},
                request=httpx.Request("GET", url),
            )

        def post(self, url: str, **kwargs: Any) -> httpx.Response:
            return httpx.Response(200, json={}, request=httpx.Request("POST", url))

    count = 0

    def execute(case: Any, settings: Any) -> dict[str, Any]:
        nonlocal count
        count += 1
        if interrupt and count == 2:
            raise RuntimeError("stop")
        return {
            "case_id": case.case_id,
            "execution": "blocked"
            if case.readiness == "blocked_by_integration"
            else "executed",
            "structural_pass": True,
        }

    monkeypatch.setattr(httpx, "Client", Client)
    monkeypatch.setattr(harness, "execute_case", execute)
    if interrupt:
        with pytest.raises(RuntimeError):
            harness.main("test-model", tmp_path)
    else:
        harness.main("test-model", tmp_path)
    reports = list(tmp_path.glob("development-*.json"))
    assert len(reports) == 1
    data = json.loads(reports[0].read_text())
    assert data["complete"] is (not interrupt)
    assert data["holdout_executed"] is False
    assert len(data["runs"]) == (1 if interrupt else 20)


def test_presented_references_require_observed_tool_results() -> None:
    case = load_split().cases[0]
    fixture = case.fixtures[0].result
    assert fixture is not None
    source = fixture["data"]["documents"][0]["source"]
    response: dict[str, Any] = {
        "reply": {
            "text": "Ответ без технических меток.",
            "references": [{"url": source["url"], "title": source["title"]}],
        }
    }
    calls = [
        {
            "name": "search_knowledge",
            "arguments": {"query": "оформить отсутствие", "limit": 3},
            "result": fixture,
        }
    ]
    checks = structural_checks(case, 200, response, calls)
    assert checks["citations"] and checks["reference_urls"]
    assert not structural_checks(case, 200, response, [])["citations"]
    response["reply"]["references"][0]["url"] = "https://unknown.example/"
    checks = structural_checks(case, 200, response, calls)
    assert not checks["reference_urls"] and not checks["citations"]
