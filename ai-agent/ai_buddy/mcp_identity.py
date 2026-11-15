"""Request-local identity; never included in model/tool arguments."""

from contextvars import ContextVar
from datetime import datetime
from typing import Protocol
from uuid import UUID

from pydantic import SecretStr

from ai_buddy.schemas import ClosedModel


class Principal(ClosedModel):
    subject: str
    allowed_tools: frozenset[str]
    request_id: UUID | None = None
    conversation_id: UUID | None = None
    expires_at: datetime | None = None
    api_token: SecretStr | None = None


PRINCIPAL: ContextVar[Principal] = ContextVar("mcp_principal")


class Authenticator(Protocol):
    async def authenticate(self, token: str) -> Principal: ...
