import asyncio
import gzip
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from ai_buddy.config import Settings
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import CONTRACTS
from evals import harness
from evals.golden import CallRule, Fixture, load_split

FIXTURES = json.loads(
    (Path(harness.__file__).with_name("current-tools.json")).read_text()
)


@pytest.mark.parametrize("tool", sorted(CONTRACTS))
def test_all_current_tools_via_flask_deepseek_sdk(
    tool: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert set(FIXTURES) == set(CONTRACTS)
    raw = FIXTURES[tool]
    data = raw["data"]
    sources = (
        [d["source"] for d in data["documents"]]
        if tool == "search_knowledge"
        else data.get("references", [])
    )
    ids = [s["id"] for s in sources]
    base = load_split().cases[0]
    case = base.model_copy(
        update={
            "input": {**base.input, "message": "Проверь запись."},
            "context": {
                **base.context,
                "permissions": ["access:submit"]
                if tool == "submit_access_request"
                else [],
            },
            "fixtures": [
                Fixture(
                    id="synthetic-fixture",
                    tool=tool,
                    arguments=raw["arguments"],
                    result={"ok": True, "data": data},
                    transport_error=None,
                )
            ],
            "expected": base.expected.model_copy(
                update={
                    "calls": [
                        CallRule(
                            tool=tool,
                            arguments_example=raw["arguments"],
                            argument_match="semantic_query"
                            if tool == "search_knowledge"
                            else "exact",
                            query_intent="Учебная инструкция"
                            if tool == "search_knowledge"
                            else None,
                            min_calls=1,
                            max_calls=1,
                        )
                    ],
                    "allowed_source_ids": ids,
                    "required_source_ids": ids,
                }
            ),
        }
    )
    calls = []

    def model(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["authorization"] == "Bearer private-test-key"
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            assert any(t["function"]["name"] == tool for t in body["tools"])
            message = {
                "role": "assistant",
                "content": None,
                "reasoning_content": "hidden reasoning",
                "tool_calls": [
                    {
                        "id": "native-id",
                        "type": "function",
                        "function": {
                            "name": tool,
                            "arguments": json.dumps(raw["arguments"]),
                        },
                    }
                ],
            }
            reason = "tool_calls"
        else:
            assert body["messages"][-1]["tool_call_id"] == "native-id"
            message = {
                "role": "assistant",
                "content": "Учебные данные." + (" [" + ids[0] + "]" if ids else ""),
                "reasoning_content": "hidden reasoning",
            }
            reason = "stop"
        return httpx.Response(
            200,
            json={
                "model": "returned-model",
                "choices": [{"message": message, "finish_reason": reason}],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
                "private": "discard",
            },
        )

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kwargs: httpx.MockTransport(model)
    )
    result = harness.execute_case(
        case,
        Settings(
            service_token=SecretStr("synthetic-service"),
            mcp_url="http://127.0.0.1/mcp",
            agent_enabled=True,
            llm_provider="deepseek",
            deepseek_api_key=SecretStr("private-test-key"),
        ),
    )
    assert result["status"] == 200, result
    assert result["structural_pass"], result
    assert [c["name"] for c in result["actual_calls"]] == [tool]
    serialized = json.dumps(result)
    assert "private-test-key" not in serialized and "hidden reasoning" not in serialized
    assert result["model_calls"][0]["response"]["model"] == "returned-model"


def test_no_live_opt_in_or_key_never_sends_requests(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def forbidden(*args: Any, **kwargs: Any) -> Any:
        pytest.fail("unexpected network or preflight")

    monkeypatch.setattr(httpx, "Client", forbidden)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    with pytest.raises(ValueError, match="allow-live"):
        harness.main("test", tmp_path, provider="deepseek")
    with pytest.raises(ValueError, match="credential"):
        harness.main("test", tmp_path, provider="deepseek", allow_live_llm=True)
    assert not list(tmp_path.iterdir())


def test_deepseek_report_metadata_no_ollama_or_holdout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "private-report-key")
    monkeypatch.setattr(
        httpx, "Client", lambda **kw: pytest.fail("Ollama preflight called")
    )
    original = load_split

    def development_only(version: str) -> Any:
        assert version == "agent-v1"
        return original()

    monkeypatch.setattr(harness, "load_development", development_only)

    def execute(case: Any, settings: Settings) -> dict[str, Any]:
        assert (
            settings.llm_provider == "deepseek"
            and settings.deepseek_model == "requested-model"
        )
        return {
            "case_id": case.case_id,
            "execution": "blocked"
            if case.readiness == "blocked_by_integration"
            else "executed",
            "structural_pass": False,
        }

    monkeypatch.setattr(harness, "execute_case", execute)
    path = harness.main(
        "requested-model", tmp_path, provider="deepseek", allow_live_llm=True
    )
    report = json.loads(path.read_text())
    assert report["provider"] == "deepseek" and len(report["runtime_tools"]) == 11
    assert report["tool_schema_sha256"] != report["dataset_tool_schema_sha256"]
    assert report["summary"]["blocked"] == 2 and report["holdout_executed"] is False
    assert "private-report-key" not in path.read_text()


@pytest.mark.parametrize("failure", ["oversize", "json", "timeout", "status"])
def test_recorder_bounded_failures_close_streams(failure: str) -> None:
    class Stream(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self) -> Any:
            if failure == "timeout":
                await asyncio.sleep(10)
            yield b"x" * (65537 if failure == "oversize" else 1)

        async def aclose(self) -> None:
            self.closed = True

    async def run() -> None:
        stream = Stream()
        records: list[dict[str, Any]] = []
        recorder = harness.ModelRecorder(
            httpx.MockTransport(
                lambda request: httpx.Response(
                    500 if failure == "status" else 200, stream=stream
                )
            ),
            records,
            False,
            "deepseek",
        )
        async with httpx.AsyncClient(transport=recorder) as client:
            if failure == "status":
                response = await client.post(
                    "https://api.deepseek.com/chat/completions", json={"model": "test"}
                )
                assert response.status_code == 500 and not response.content
            else:
                with pytest.raises((ServiceError, TimeoutError)):
                    async with asyncio.timeout(0.02):
                        await client.post(
                            "https://api.deepseek.com/chat/completions",
                            json={"model": "test"},
                        )
        assert stream.closed
        assert "response" not in records[0]

    asyncio.run(run())


def test_ambiguous_fixtures_fail_before_model_and_argument_dispatch() -> None:
    case = load_split().cases[0]
    with pytest.raises(ValueError, match="ambiguous"):
        harness.FixtureBackend(case.model_copy(update={"fixtures": case.fixtures * 2}))
    a = Fixture(
        id="a",
        tool="get_task_context",
        arguments={"task_id": "a"},
        result={
            "ok": True,
            "data": {**FIXTURES["get_task_context"]["data"], "task_id": "a"},
        },
        transport_error=None,
    )
    assert a.result is not None
    b = a.model_copy(
        update={
            "id": "b",
            "arguments": {"task_id": "b"},
            "result": {"ok": True, "data": {**a.result["data"], "task_id": "b"}},
        }
    )
    backend = harness.FixtureBackend(case.model_copy(update={"fixtures": [a, b]}))

    async def run() -> None:
        assert (await backend.read("demo", "get_task_context", {"task_id": "b"}))[
            "data"
        ]["task_id"] == "b"
        with pytest.raises(ServiceError) as error:
            await backend.read("demo", "get_task_context", {"task_id": "other"})
        assert error.value.code == ErrorCode.INVALID_TOOL

    asyncio.run(run())


def test_compressed_provider_response_is_decoded_once() -> None:
    async def run() -> None:
        data = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "Учебный ответ",
                        "reasoning_content": "hidden",
                    },
                    "finish_reason": "stop",
                }
            ]
        }
        recorder = harness.ModelRecorder(
            httpx.MockTransport(
                lambda req: httpx.Response(
                    200,
                    content=gzip.compress(json.dumps(data).encode()),
                    headers={"Content-Encoding": "gzip"},
                )
            ),
            [],
            False,
            "deepseek",
        )
        async with httpx.AsyncClient(transport=recorder) as client:
            response = await client.post(
                "https://api.deepseek.com/chat/completions", json={"model": "test"}
            )
            assert response.json() == data

    asyncio.run(run())


def test_submit_is_not_advertised_without_fixture_permission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = (
        load_split()
        .cases[0]
        .model_copy(
            update={
                "input": {**load_split().cases[0].input, "message": "Проверь запись."}
            }
        )
    )

    def model(request: httpx.Request) -> httpx.Response:
        names = {t["function"]["name"] for t in json.loads(request.content)["tools"]}
        assert "submit_access_request" not in names and len(names) == 10
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "tool_calls": [
                                {
                                    "id": "one",
                                    "type": "function",
                                    "function": {
                                        "name": "submit_access_request",
                                        "arguments": json.dumps(
                                            FIXTURES["submit_access_request"][
                                                "arguments"
                                            ]
                                        ),
                                    },
                                }
                            ],
                        },
                    }
                ]
            },
        )

    monkeypatch.setattr(
        httpx, "AsyncHTTPTransport", lambda **kw: httpx.MockTransport(model)
    )
    result = harness.execute_case(
        case,
        Settings(
            service_token=SecretStr("synthetic"),
            mcp_url="http://127.0.0.1/mcp",
            agent_enabled=True,
            llm_provider="deepseek",
            deepseek_api_key=SecretStr("synthetic-key"),
        ),
    )
    assert (
        result["status"] == 503
        and result["response"]["error"]["code"] == "INVALID_TOOL"
    )
    assert not result["actual_calls"]
