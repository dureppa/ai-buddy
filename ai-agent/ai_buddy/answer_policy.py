"""Per-turn evidence checks; heuristic quarantine is not a universal injection detector."""

import re
import unicodedata
from dataclasses import dataclass
from typing import Any

DIRECTIVES = re.compile(
    r"system\s*prompt|developer\s*(?:message|mode)|системн\w*\s*(?:промпт|инструкц)|"
    r"(?:ignore|disregard|override|forget)\b.{0,80}(?:instructions?|rules?|previous|system)|"
    r"(?:игнорир|забуд|переопредел|обойди)\w*.{0,80}(?:инструкц|правил|предыдущ|ограничен)|"
    r"(?:внимание|инструкция|команда)\s+(?:агенту|ассистенту|модели)|"
    r"(?:assistant|system|developer)\s*:|\[/?(?:INST|SYSTEM)\]|<\|[^>]+\|>|"
    r"<(?:script|iframe|style|a)\b|javascript\s*:|data\s*:",
    re.IGNORECASE | re.DOTALL,
)
CITATION = re.compile(r"\[([^\]\n]+)\](?!\s*\()")
MARKDOWN_LINK = re.compile(r"\[[^\]\n]*\]\(\s*([^\s)]+)(?:\s+[^)]*)?\)")
URL = re.compile(r"https?://[^\s<>\[\]()\"']+", re.IGNORECASE)
SOURCE_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}\Z")
UNVERIFIED = "Не могу подтвердить ответ по полученным источникам. Пожалуйста, уточните у наставника."
NO_EVIDENCE = "В доступных источниках нет информации для ответа. Пожалуйста, уточните у наставника."
QUARANTINED = "Документ исключён из контекста: в нём обнаружены подозрительные инструкции для агента. Не могу безопасно подтвердить ответ; пожалуйста, уточните у наставника."


class UnsafeContent(ValueError):
    """A tool payload cannot be admitted to the model's evidence context."""


def suspicious(text: str) -> bool:
    normalized = unicodedata.normalize("NFKC", text)
    if any(unicodedata.category(c) == "Cf" for c in normalized):
        return True
    return bool(DIRECTIVES.search(normalized))


def unsafe_tree(value: Any) -> bool:
    if isinstance(value, str):
        return suspicious(value)
    if isinstance(value, dict):
        return any(unsafe_tree(k) or unsafe_tree(v) for k, v in value.items())
    if isinstance(value, list):
        return any(unsafe_tree(item) for item in value)
    return False


@dataclass(frozen=True)
class Screened:
    data: dict[str, Any]
    sources: dict[str, str]
    quarantined: int = 0


def screen_payload(name: str, data: dict[str, Any]) -> Screened:
    quarantined = 0
    if name == "search_knowledge":
        documents = data["documents"]
        clean = [d for d in documents if not unsafe_tree(d)]
        quarantined = len(documents) - len(clean)
        if documents and not clean:
            raise UnsafeContent("UNTRUSTED_CONTENT")
        data = {"documents": clean}
        sources = [d["source"] for d in clean]
    else:
        if unsafe_tree(data):
            raise UnsafeContent("UNTRUSTED_CONTENT")
        sources = data["references"]
    registry: dict[str, str] = {}
    for source in sources:
        identifier, url = source["id"], source["url"]
        if not SOURCE_ID.fullmatch(identifier):
            raise UnsafeContent("INVALID_SOURCE_ID")
        if identifier in registry and registry[identifier] != url:
            raise UnsafeContent("CONFLICTING_SOURCE")
        registry[identifier] = url
    return Screened(data, registry, quarantined)


def citation_issues(text: str, sources: dict[str, str]) -> list[str]:
    issues: list[str] = []
    if any(identifier not in sources for identifier in CITATION.findall(text)):
        issues.append("UNKNOWN_SOURCE")
    allowed_urls = set(sources.values())
    targets = MARKDOWN_LINK.findall(text)
    # Reject unrecognised Markdown targets, autolinks, raw URLs and HTML links.
    if any(target.strip("<>") not in allowed_urls for target in targets):
        issues.append("UNKNOWN_URL")
    if any(url.rstrip(".,;!?") not in allowed_urls for url in URL.findall(text)):
        issues.append("UNKNOWN_URL")
    if re.search(r"<\s*a\b|(?:href|src)\s*=|!\[|\]\s*\[", text, re.IGNORECASE):
        issues.append("UNSUPPORTED_LINK_FORMAT")
    return sorted(set(issues))


def answer_issues(text: str, sources: dict[str, str]) -> list[str]:
    issues = citation_issues(text, sources)
    if sources and not (
        CITATION.search(text) or MARKDOWN_LINK.search(text) or URL.search(text)
    ):
        issues.append("MISSING_CITATION")
    if suspicious(text):
        issues.append("UNSAFE_OUTPUT")
    return sorted(set(issues))


@dataclass(frozen=True)
class CheckedAnswer:
    text: str
    status: str
    issues: list[str]


def check_answer(
    text: str,
    sources: dict[str, str],
    *,
    quarantined: bool = False,
    empty_knowledge: bool = False,
    invalid_evidence: bool = False,
) -> CheckedAnswer:
    if quarantined and not sources:
        return CheckedAnswer(QUARANTINED, "safe_abstention", ["UNTRUSTED_CONTENT"])
    if invalid_evidence and not sources:
        return CheckedAnswer(UNVERIFIED, "safe_abstention", ["INVALID_EVIDENCE"])
    if empty_knowledge and not sources:
        return CheckedAnswer(NO_EVIDENCE, "safe_abstention", ["EMPTY_KNOWLEDGE"])
    issues = answer_issues(text, sources)
    if issues:
        return CheckedAnswer(UNVERIFIED, "safe_abstention", sorted(set(issues)))
    return CheckedAnswer(text, "accepted", [])
