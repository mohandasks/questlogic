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

    # Optional Postgres for llm_calls telemetry, and for the course-ingestion
    # CLI (curated subjects) which writes curriculum_templates/template_nodes/
    # curated_lecture_sources directly. Required for `ingest-course` to work;
    # optional (and no-op) for the FastAPI service itself.
    database_url: str | None = Field(default=None, alias="DATABASE_URL")

    # Optional Cloudflare R2 (S3-compatible) storage for original course PDFs,
    # used only by the course-ingestion CLI for provenance / "view original"
    # links. If unset, ingestion still works — it just skips the upload and
    # leaves curated_lecture_sources.original_pdf_path null.
    r2_account_id: str | None = Field(default=None, alias="R2_ACCOUNT_ID")
    r2_access_key_id: str | None = Field(default=None, alias="R2_ACCESS_KEY_ID")
    r2_secret_access_key: str | None = Field(default=None, alias="R2_SECRET_ACCESS_KEY")
    r2_bucket_name: str | None = Field(default=None, alias="R2_BUCKET_NAME")
    r2_public_base_url: str | None = Field(default=None, alias="R2_PUBLIC_BASE_URL")


settings = Settings()
