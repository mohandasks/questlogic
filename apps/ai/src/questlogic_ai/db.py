"""Thin Postgres helper for llm_calls telemetry.

The web service owns most DB writes; this module is here purely so every LLM
call can record a row in `llm_calls`. If DATABASE_URL is unset, all writes
become no-ops and the service still runs.
"""

from __future__ import annotations

import logging
from typing import Any

import asyncpg

from .settings import settings

log = logging.getLogger(__name__)
_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool | None:
    global _pool
    if settings.database_url is None:
        return None
    if _pool is None:
        try:
            _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=4)
        except Exception:  # noqa: BLE001
            log.exception("Could not create Postgres pool; telemetry disabled")
            _pool = None
    return _pool


async def record_llm_call(
    *,
    user_id: str | None,
    session_id: str | None,
    pipeline: str,
    model: str,
    provider: str,
    tokens_in: int,
    tokens_out: int,
    cost_micros: int,
    latency_ms: int,
    succeeded: bool,
    error_class: str | None = None,
    langfuse_trace_id: str | None = None,
) -> None:
    pool = await get_pool()
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO llm_calls
                  (user_id, session_id, pipeline, model, provider,
                   tokens_in, tokens_out, cost_micros, latency_ms,
                   succeeded, error_class, langfuse_trace_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                """,
                _as_uuid(user_id),
                _as_uuid(session_id),
                pipeline,
                model,
                provider,
                tokens_in,
                tokens_out,
                cost_micros,
                latency_ms,
                succeeded,
                error_class,
                langfuse_trace_id,
            )
    except Exception:  # noqa: BLE001
        log.exception("Failed to record llm_call")


def _as_uuid(v: Any) -> Any:
    # asyncpg expects UUID type, but accepts strings if the column is uuid; let it.
    return v
