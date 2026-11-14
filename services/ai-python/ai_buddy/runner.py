"""Flask runner using native Ollama and the shared bounded agent."""

import logging
import time

from ai_buddy.agent import Trace, direct_loop, finalize
from ai_buddy.answer_policy import CITATION, MARKDOWN_LINK, URL
from ai_buddy.config import Settings
from ai_buddy.errors import ServiceError
from ai_buddy.mcp_client import CONTRACTS, Gateway
from ai_buddy.provider import model_session
from ai_buddy.schemas import Reference, Reply, TurnRequest

default_logger = logging.getLogger(__name__)


class DirectRunner:
    def __init__(
        self, settings: Settings, *, logger: logging.Logger | None = None
    ) -> None:
        self.settings = settings
        self.logger = logger or default_logger

    async def run(self, context: TurnRequest, gateway: Gateway) -> Reply:
        state = Trace(raise_tool_errors=True)
        started = time.monotonic()
        outcome = "ERROR"
        try:
            async with model_session(self.settings) as chat:
                state.raw_answer = await direct_loop(
                    gateway,
                    context.message,
                    chat,
                    state,
                    history=context.history,
                    recover_context=True,
                    hr_today=context.hr_today.model_dump_json()
                    if context.hr_today
                    else None,
                    page_url=context.page_context.url if context.page_context else None,
                )
            finalize(state)
            ids = set(CITATION.findall(state.answer))
            urls = set(MARKDOWN_LINK.findall(state.answer))
            urls.update(url.rstrip(".,;!?") for url in URL.findall(state.answer))
            references = [
                Reference(title=state.source_titles[identifier], url=url)
                for identifier, url in state.sources.items()
                if identifier in ids or url in urls
            ][:5]
            outcome = state.answer_status
            return Reply(text=state.answer, references=references)
        except ServiceError as error:
            outcome = error.code.value
            raise
        finally:
            self.logger.info(
                "ai_turn request_id=%s provider=%s model=%s prompt=onboarding-v3 model_calls=%d tool_calls=%d guard_count=%d outcome=%s seconds=%.3f tools=%s guards=%s",
                context.request_id,
                self.settings.llm_provider,
                self.settings.model_name,
                state.model_calls,
                len(state.calls),
                len(state.guard_events),
                outcome,
                time.monotonic() - started,
                ",".join(
                    call["name"] for call in state.calls if call["name"] in CONTRACTS
                ),
                ",".join(sorted(set(state.guard_events))),
            )
