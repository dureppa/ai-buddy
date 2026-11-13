import os
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator

from ai_buddy.schemas import ClosedModel, safe_url


class Settings(ClosedModel):
    service_token: SecretStr | None = None
    mcp_url: str | None = None
    turn_timeout: Annotated[float, Field(gt=0, le=25)] = 25.0
    tool_timeout: Annotated[float, Field(gt=0, le=5)] = 5.0
    max_tool_calls: Annotated[int, Field(ge=1, le=6)] = 6

    @field_validator("service_token")
    @classmethod
    def valid_token(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and (
            not value.get_secret_value()
            or any(ord(c) < 33 or ord(c) == 127 for c in value.get_secret_value())
        ):
            raise ValueError("invalid service token")
        return value

    @field_validator("mcp_url")
    @classmethod
    def fixed_url(cls, value: str | None) -> str | None:
        if value is not None:
            safe_url(value)
            parts = urlsplit(value)
            if parts.query or parts.fragment:
                raise ValueError("MCP URL must not contain query or fragment")
        return value

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.environ.get("AI_SERVICE_TOKEN")
        return cls(
            service_token=SecretStr(token) if token else None,
            mcp_url=os.environ.get("MCP_URL") or None,
        )

    @property
    def configured(self) -> bool:
        return self.service_token is not None and self.mcp_url is not None
