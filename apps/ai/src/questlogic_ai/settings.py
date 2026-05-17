"""Centralized settings, loaded from env (and repo-root .env if present)."""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Walk up from this file to find the nearest .env (handles both running from
# the repo root via pnpm dev:ai and running from apps/ai directly). Loading is
# silent if no .env is found — pydantic-settings will then fall back to OS env.
def _find_repo_env() -> Path | None:
    here = Path(__file__).resolve()
    for ancestor in [here, *here.parents]:
        candidate = ancestor / ".env"
        if candidate.is_file():
            return candidate
    return None


_env = _find_repo_env()
if _env is not None:
    load_dotenv(_env)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    # Auth between Next.js and this service.
    shared_secret: str = Field(default="", alias="AI_SERVICE_SHARED_SECRET")

    # Models.
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    model_tutor: str = Field(default="claude-sonnet-4-6", alias="ANTHROPIC_MODEL_TUTOR")
    model_curriculum: str = Field(
        default="claude-sonnet-4-6", alias="ANTHROPIC_MODEL_CURRICULUM"
    )
    model_cheap: str = Field(
        default="claude-haiku-4-5-20251001", alias="ANTHROPIC_MODEL_CHEAP"
    )

    # Optional Postgres for llm_calls telemetry.
    database_url: str | None = Field(default=None, alias="DATABASE_URL")


settings = Settings()
