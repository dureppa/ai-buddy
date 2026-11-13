"""Development-only Flask/Ollama/real MCP harness with explicit semantic review."""

import argparse
import hashlib
import json
import logging
import subprocess
import time
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from pydantic import SecretStr

from ai_buddy import create_app
from ai_buddy.agent import PROMPT as CHAT_PROMPT
from ai_buddy.answer_policy import CITATION, MARKDOWN_LINK, URL
from ai_buddy.assessment import PROMPT as ASSESSMENT_PROMPT
from ai_buddy.assessment import AssessmentResult
from ai_buddy.config import Settings
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import CONTRACTS, LimitedTransport, Session, classified_error
from ai_buddy.mcp_server import create_mcp_app
from ai_buddy.schemas import TurnRequest
from evals.golden import DIRECTORY, Case, load_split, tool_schema_hash

REPORTS = Path(__file__).with_name("reports")


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()


class FixtureBackend:
    """Scripted environment, not search quality; actual query intent needs review."""

    def __init__(self, case: Case) -> None:
        self.fixtures = {f.tool: f for f in case.fixtures}
        self.calls: list[dict[str, Any]] = []

    async def read(
        self, subject: str, tool: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        entry: dict[str, Any] = {"name": tool, "arguments": arguments}
        self.calls.append(entry)
        fixture = self.fixtures.get(tool)
        if fixture is None:
            entry["error"] = "INVALID_TOOL"
            raise ServiceError(ErrorCode.INVALID_TOOL)
        if fixture.transport_error:
            entry["injected_error"] = fixture.transport_error.value
            raise ServiceError(fixture.transport_error)
        assert fixture.result is not None
        entry["result"] = fixture.result
        if not fixture.result["ok"]:
            raise ServiceError(ErrorCode(fixture.result["error"]["code"]))
        return fixture.result


def structural_checks(
    case: Case, status: int, response: dict[str, Any], calls: list[dict[str, Any]]
) -> dict[str, bool]:
    exp = case.expected
    counts = Counter(call["name"] for call in calls)
    checks = {
        "http_status": status == exp.http_status,
        "error_code": response.get("error", {}).get("code")
        == (exp.error_code.value if exp.error_code else None),
        "allowed_tools": not (set(counts) - {c.tool for c in exp.calls}),
        "call_counts": all(
            c.min_calls <= counts[c.tool] <= c.max_calls for c in exp.calls
        ),
        "argument_shapes": True,
        "exact_arguments": True,
    }
    for call in calls:
        rule = next((r for r in exp.calls if r.tool == call["name"]), None)
        contract = CONTRACTS.get(call["name"])
        try:
            if contract is None:
                raise ValueError("unknown tool")
            contract.arguments.model_validate_json(json.dumps(call["arguments"]))
        except ValueError:
            checks["argument_shapes"] = False
        if (
            rule
            and rule.argument_match == "exact"
            and call["arguments"] != rule.arguments_example
        ):
            checks["exact_arguments"] = False
    ordered = [call["name"] for call in calls if call["name"] in exp.ordered_tools]
    checks["dependency_order"] = ordered == exp.ordered_tools
    if status == 200:
        checks["bound_ids"] = all(
            response.get(k) == case.input[k] for k in ("request_id", "conversation_id")
        )
    if case.mode == "assessment":
        gold = exp.assessment
        assert gold is not None
        actual = response.get("assessment", {})
        checks["assessment_labels"] = {
            c["criterion_id"]: c["verdict"] for c in actual.get("criteria", [])
        } == gold.criteria
        checks["assessment_decision"] = all(
            actual.get(k) == getattr(gold, k)
            for k in (
                "recommendation",
                "method",
                "guard_reason",
                "manual_review_required",
            )
        )
        try:
            AssessmentResult.model_validate_json(json.dumps(actual))
        except ValueError:
            checks["assessment_schema"] = False
        else:
            checks["assessment_schema"] = True
        checks["assessment_versions"] = all(
            actual.get(k) == case.input[k]
            for k in (
                "evaluation_id",
                "answer_id",
                "task_id",
                "task_version",
                "plan_version",
                "answer_version",
                "rubric_id",
                "rubric_version",
                "context_version",
            )
        )
        checks["answer_hash"] = (
            actual.get("answer_sha256")
            == hashlib.sha256(case.input["answer"].encode()).hexdigest()
        )
    else:
        reply = response.get("reply", {})
        text = reply.get("text", "")
        sources = {}
        for call in calls:
            result = call.get("result")
            if result and result.get("ok"):
                data = result["data"]
                for source in (
                    [d["source"] for d in data["documents"]]
                    if call["name"] == "search_knowledge"
                    else data.get("references", [])
                ):
                    sources[source["id"]] = source["url"]
        ids = set(CITATION.findall(text))
        urls = set(MARKDOWN_LINK.findall(text)) | {
            u.rstrip(".,;!?") for u in URL.findall(text)
        }
        ids |= {i for i, url in sources.items() if url in urls}
        allowed = set(exp.allowed_source_ids) & set(sources)
        allowed_urls = {sources[i] for i in allowed}
        checks["citations"] = ids <= allowed and set(exp.required_source_ids) <= ids
        checks["reference_urls"] = all(
            r["url"] in allowed_urls for r in reply.get("references", [])
        )
        checks["no_unknown_urls"] = urls <= {sources[i] for i in allowed}
    return checks


class ModelRecorder(httpx.AsyncBaseTransport):
    def __init__(
        self, inner: httpx.AsyncBaseTransport, calls: list[dict[str, Any]], fault: bool
    ) -> None:
        self.inner, self.calls, self.fault = inner, calls, fault

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        item: dict[str, Any] = {"request": json.loads(request.content)}
        self.calls.append(item)
        if self.fault:
            item["injected_status"] = 429
            return httpx.Response(429, request=request)
        response = await self.inner.handle_async_request(request)
        await response.aread()
        item["status"] = response.status_code
        if response.status_code == 200:
            data = response.json()
            # Deliberately omit thinking/hidden reasoning.
            item["response"] = {
                k: data[k]
                for k in ("eval_count", "prompt_eval_count", "done_reason")
                if k in data
            }
            item["response"]["message"] = {
                k: v
                for k, v in data.get("message", {}).items()
                if k in {"role", "content", "tool_calls"}
            }
        return response

    async def aclose(self) -> None:
        await self.inner.aclose()


def execute_case(case: Case, settings: Settings) -> dict[str, Any]:
    if case.readiness == "blocked_by_integration":
        return {
            "case_id": case.case_id,
            "execution": "blocked",
            "blockers": case.blockers,
            "passed": None,
        }
    backend = FixtureBackend(case)
    model_calls: list[dict[str, Any]] = []
    transport_class = httpx.AsyncHTTPTransport

    def capture(**kwargs: Any) -> ModelRecorder:
        return ModelRecorder(
            transport_class(**kwargs),
            model_calls,
            case.fault == ErrorCode.AI_RATE_LIMITED,
        )

    @asynccontextmanager
    async def factory(context: TurnRequest) -> AsyncIterator[Session]:
        app = create_mcp_app(
            backend,
            principals={
                context.delegation_token.get_secret_value(): "synthetic-eval-profile"
            },
        )
        try:
            async with (
                app.router.lifespan_context(app),
                httpx.AsyncClient(
                    transport=LimitedTransport(httpx.ASGITransport(app=app)),
                    headers={
                        "Authorization": "Bearer "
                        + context.delegation_token.get_secret_value()
                    },
                    trust_env=False,
                ) as client,
                streamable_http_client("http://127.0.0.1/mcp", http_client=client) as (
                    read,
                    write,
                    _,
                ),
                ClientSession(read, write) as session,
            ):
                await session.initialize()
                yield session
        except Exception as error:  # noqa: BLE001 -- match production SDK boundary
            raise classified_error(error) from None

    assert settings.service_token is not None
    started = time.monotonic()
    httpx.AsyncHTTPTransport = capture  # type: ignore[misc,assignment]
    try:
        client = create_app(settings, session_factory=factory).test_client()
        response = client.post(
            "/internal/v1/assessments"
            if case.mode == "assessment"
            else "/internal/v1/turns",
            json=case.input,
            headers={
                "Authorization": "Bearer " + settings.service_token.get_secret_value()
            },
        )
    finally:
        httpx.AsyncHTTPTransport = transport_class  # type: ignore[misc]
    data = response.get_json()
    checks = structural_checks(case, response.status_code, data, backend.calls)
    token = case.input.get("delegation_token")
    checks["model_has_no_token"] = not token or token not in json.dumps(
        model_calls, ensure_ascii=False
    )
    return {
        "case_id": case.case_id,
        "mode": case.mode,
        "fault_injection": case.fault.value if case.fault else None,
        "execution": "executed",
        "seconds": round(time.monotonic() - started, 3),
        "status": response.status_code,
        "response": data,
        "response_sha256": digest(data),
        "actual_calls": backend.calls,
        "model_calls": model_calls,
        "structural_checks": checks,
        "structural_pass": all(checks.values()),
        "semantic": "unassessed",
        "passed": None,
    }


def main(model: str, output_dir: Path = REPORTS) -> Path:
    # No split option: holdout is intentionally inaccessible to this command.
    dataset = load_split()
    settings = Settings(
        service_token=SecretStr("synthetic-harness-service"),
        mcp_url="http://127.0.0.1/mcp",
        agent_enabled=True,
        ollama_model=model,
    )
    with httpx.Client(timeout=60, trust_env=False) as client:
        tags = client.get(settings.ollama_url + "/api/tags").json()["models"]
        selected = next(t for t in tags if t["name"] == model)
        warmup = client.post(
            settings.ollama_url + "/api/chat",
            json={
                "model": model,
                "messages": [{"role": "user", "content": "Ответь ОК."}],
                "stream": False,
                "think": False,
                "options": {"num_predict": 8},
            },
        )
        warmup.raise_for_status()
    output_dir.mkdir(exist_ok=True, parents=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    path = output_dir / f"development-{stamp}.json"
    report: dict[str, Any] = {
        "version": "agent-harness-v2",
        "created_at": stamp,
        "git_commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True
        ).strip(),
        "code_hashes": {
            str(p): hashlib.sha256(p.read_bytes()).hexdigest()
            for d in (Path("ai_buddy"), Path("evals"))
            for p in d.glob("*.py")
        },
        "dataset_sha256": hashlib.sha256(
            (DIRECTORY / "development.json").read_bytes()
        ).hexdigest(),
        "tool_schema_sha256": tool_schema_hash(),
        "prompt_hashes": {
            "chat": digest(CHAT_PROMPT),
            "assessment": digest(ASSESSMENT_PROMPT),
        },
        "model": selected,
        "split": "development",
        "label_status": dataset.label_status,
        "scope": "Real Flask/native Ollama and production local MCP factory via SDK ASGI transport; scripted fixture backend, not Go/retrieval benchmark. Query intent and facts need explicit review.",
        "turn_timeout": settings.turn_timeout,
        "model_timeout": settings.model_timeout,
        "holdout_executed": False,
        "complete": False,
        "runs": [],
    }
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    for case in dataset.cases:
        result = execute_case(case, settings)
        report["runs"].append(result)
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(
            case.case_id,
            result["execution"],
            result.get("status"),
            result.get("structural_pass"),
            flush=True,
        )
    report["complete"] = True
    report["summary"] = {
        "total": len(dataset.cases),
        "executed": sum(r["execution"] == "executed" for r in report["runs"]),
        "blocked": sum(r["execution"] == "blocked" for r in report["runs"]),
        "structural_pass": sum(r.get("structural_pass", False) for r in report["runs"]),
        "semantic_assessed": 0,
    }
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("Saved", path, flush=True)
    return path


if __name__ == "__main__":
    logging.getLogger("httpx").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="qwen3:4b-q4_K_M")
    parser.add_argument("--output-dir", type=Path, default=REPORTS)
    args = parser.parse_args()
    main(args.model, args.output_dir)
