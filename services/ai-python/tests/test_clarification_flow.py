"""Clarification must survive retrieval and citation repair; no real LLM calls."""

import json
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from ai_buddy.config import Settings
from evals.development import load_development
from evals.harness import execute_case


def test_clarifying_question_survives_recovery_and_citation_repair(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = load_development("agent-v2").cases[1]
    source = "dev-02-absences"
    question = "Уточните, пожалуйста, тип отсутствия, дату начала и дату окончания."
    requests: list[dict[str, Any]] = []

    def model(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        # Recovery supplies a source after the initial clarification. Missing citation
        # in the second answer exercises the final repair, not a scripted tool plan.
        if len(requests) > 1:
            assert "Демо-заявка на отсутствие" in json.dumps(body, ensure_ascii=False)
            assert "попроси" in body["messages"][0]["content"].casefold()
            assert "forbidden_claims" not in json.dumps(body)
        content = question + (f" [{source}]" if len(requests) == 3 else "")
        return httpx.Response(
            200,
            json={
                "model": "mock",
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": content},
                    }
                ],
            },
        )

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kw: httpx.MockTransport(model)
    )
    result = execute_case(
        case,
        Settings(
            service_token=SecretStr("synthetic"),
            mcp_url="http://127.0.0.1/mcp",
            agent_enabled=True,
            llm_provider="deepseek",
            deepseek_api_key=SecretStr("synthetic"),
        ),
    )
    assert len(requests) == 3
    assert result["response"]["reply"]["text"] == question
    assert result["structural_pass"]
    assert [c["name"] for c in result["actual_calls"]] == ["search_knowledge"]
