from typing import Any

from ai_buddy.agent import Trace
from ai_buddy.runner import present_answer


def test_registered_ids_are_hidden_only_after_references_are_available() -> None:
    trace = Trace(
        answer="**Наставник:** Анна [team:demo].", sources={"team:demo": "/team"}
    )
    assert present_answer(trace) == "**Наставник:** Анна."
    assert trace.answer.endswith("[team:demo].")
    assert trace.sources == {"team:demo": "/team"}
    assert present_answer(Trace(answer="Ответ [unknown]")) == "Ответ [unknown]"


def test_only_observed_task_id_annotations_are_removed() -> None:
    calls: list[dict[str, Any]] = [
        {
            "name": "get_onboarding_progress",
            "result": {"ok": True, "data": {"tasks": [{"id": "papers"}]}},
        },
        {
            "name": "get_task_context",
            "result": {"ok": True, "data": {"task_id": "consent-news"}},
        },
        {"name": "search_knowledge", "result": {"ok": False}},
    ]
    trace = Trace(
        answer="Документы (id 'papers'), согласие (id `consent-news`). Заявка ABC-123 (id 'unknown').",
        calls=calls,
    )
    assert (
        present_answer(trace) == "Документы, согласие. Заявка ABC-123 (id 'unknown')."
    )


def test_code_preserved_and_empty_presentation_has_readable_fallback() -> None:
    trace = Trace(
        answer="```\n[guide]  SELECT  text\n```\n`[guide]  code`",
        sources={"guide": "/guide"},
    )
    assert present_answer(trace) == trace.answer
    assert (
        present_answer(Trace(answer="[guide]", sources={"guide": "/guide"}))
        == "Подробности — в источниках ниже."
    )
