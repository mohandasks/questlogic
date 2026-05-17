"""Anthropic-specific implementation of the LlmClient surface.

Kept minimal — no retries, no fallbacks, no caching. Those live one layer up
in the pipelines or get added when the use case demands it.
"""

from __future__ import annotations

from typing import AsyncIterator, Literal

from anthropic import AsyncAnthropic

from ..settings import settings
from .types import CompletionResult

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def complete(
    *,
    model: str,
    system: str,
    messages: list[dict[str, str]],
    max_tokens: int,
    temperature: float,
    response_format: Literal["text", "json"] = "text",
) -> CompletionResult:
    client = _get_client()
    effective_system = system
    if response_format == "json":
        effective_system = (
            system
            + "\n\nReturn ONLY valid JSON. No markdown, no prose, no code fences."
        )

    resp = await client.messages.create(
        model=model,
        system=effective_system,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=messages,  # type: ignore[arg-type]
    )

    text_parts: list[str] = []
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text_parts.append(block.text)  # type: ignore[attr-defined]

    return CompletionResult(
        text="".join(text_parts).strip(),
        model=model,
        provider="anthropic",
        tokens_in=resp.usage.input_tokens,
        tokens_out=resp.usage.output_tokens,
    )


async def stream(
    *,
    model: str,
    system: str,
    messages: list[dict[str, str]],
    max_tokens: int,
    temperature: float,
) -> AsyncIterator[str]:
    client = _get_client()
    async with client.messages.stream(
        model=model,
        system=system,
        max_tokens=max_tokens,
        temperature=temperature,
        messages=messages,  # type: ignore[arg-type]
    ) as s:
        async for text in s.text_stream:
            yield text
