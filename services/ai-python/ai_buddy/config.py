import os
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator

from ai_buddy.schemas import ClosedModel, safe_url


class Settings(ClosedModel):
    service_token: SecretStr | None = None
    mcp_url: str | None = None
    turn_timeout: Annotated[float, Field(gt=0, le=25)] = 25.0
    tool_timeout: Annotated[float, Field(gt=0, le=5)] = 5.0
    agent_enabled: bool = False
    llm_provider: Literal["ollama", "deepseek"] = "ollama"
    deepseek_api_key: SecretStr | None = None
    deepseek_model: Annotated[
        str,
        Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$"),
    ] = "deepseek-flash"
    deepseek_base_url: str = "https://api.deepseek.com"

    @field_validator("deepseek_base_url")
    @classmethod
    def cloud_url(cls, value: str) -> str:
        safe_url(value)
        parts = urlsplit(value)
        if (
            parts.scheme != "https"
            or parts.path not in {"", "/", "/v1", "/v1/"}
            or parts.query
            or parts.fragment
        ):
            raise ValueError("DeepSeek requires a fixed HTTPS API origin")
        return value.rstrip("/")

    @property
    def model_name(self) -> str | None:
        return (
            self.deepseek_model
            if self.llm_provider == "deepseek"
            else self.ollama_model
        )

    @property
    def model_configured(self) -> bool:
        if self.llm_provider == "deepseek":
            return self.deepseek_api_key is not None
        return self.ollama_model is not None

    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: (
        Annotated[
            str,
            Field(
                min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
            ),
        ]
        | None
    ) = None
    model_timeout: Annotated[float, Field(gt=0, le=25)] = 20.0
    max_tool_calls: Annotated[int, Field(ge=1, le=6)] = 6

    @field_validator("service_token", "deepseek_api_key")
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

    @field_validator("ollama_url")
    @classmethod
    def local_llm_url(cls, value: str) -> str:
        safe_url(value)
        parts = urlsplit(value)
        if (
            parts.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parts.path not in {"", "/"}
            or parts.query
            or parts.fragment
        ):
            raise ValueError("Ollama URL must be a loopback origin")
        if parts.port is not None and not 1 <= parts.port <= 65535:
            raise ValueError("invalid port")
        return value.rstrip("/")

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.environ.get("AI_SERVICE_TOKEN")
        enabled = os.environ.get("AI_AGENT_ENABLED", "false").lower()
        if enabled not in {"true", "false", "1", "0"}:
            raise ValueError("AI_AGENT_ENABLED must be true or false")
        provider = os.environ.get("AI_LLM_PROVIDER", "ollama")
        if provider not in {"ollama", "deepseek"}:
            raise ValueError("AI_LLM_PROVIDER must be ollama or deepseek")
        return cls(
            agent_enabled=enabled in {"true", "1"},
            llm_provider="deepseek" if provider == "deepseek" else "ollama",
            deepseek_api_key=SecretStr(os.environ["DEEPSEEK_API_KEY"])
            if os.environ.get("DEEPSEEK_API_KEY")
            else None,
            deepseek_model=os.environ.get("DEEPSEEK_MODEL", "deepseek-flash"),
            deepseek_base_url=os.environ.get(
                "DEEPSEEK_BASE_URL", "https://api.deepseek.com"
            ),
            ollama_url=os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"),
            ollama_model=os.environ.get("OLLAMA_MODEL") or None,
            turn_timeout=float(os.environ.get("AI_TURN_TIMEOUT", "25")),
            model_timeout=float(os.environ.get("AI_MODEL_TIMEOUT", "20")),
            service_token=SecretStr(token) if token else None,
            mcp_url=os.environ.get("MCP_URL") or None,
        )

    @property
    def configured(self) -> bool:
        return self.service_token is not None and self.mcp_url is not None
