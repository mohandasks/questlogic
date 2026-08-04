"""Anthropic-specific implementation of the LlmClient surface.

Kept minimal — no retries, no fallbacks, no caching. Those live one layer up
in the pipelines or get added when the use case demands it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator, Callable, Literal

from anthropic import AsyncAnthropic

from ..settings import settings
from .types import CompletionResult, SystemBlock

_client: AsyncAnthropic | None = None


@dataclass
class CompletionUsage:
    tokens_in: int
    tokens_out: int
    cache_creation_tokens: int
    cache_read_tokens: int


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def _render_system(system: str | list[SystemBlock]) -> str | list[dict]:
    """Plain string in, plain string out (unchanged behavior). A list of
    SystemBlocks in, an Anthropic content-block array out, with
    `cache_control` set on any block marked cacheable — this is what actually
    turns on prompt caching for that prefix of the system prompt."""
    if isinstance(system, str):
        return system
    blocks: list[dict] = []
    for b in system:
        block: dict = {"type": "text", "text": b.text}
        if b.cacheable:
            block["cache_control"] = {"type": "ephemeral"}
        blocks.append(block)
    return blocks


def _usage_ints(usage) -> tuple[int, int, int, int]:
    """Anthropic only sets cache_creation_input_tokens / cache_read_input_tokens
    on responses that actually used caching; default to 0 otherwise."""
    return (
        usage.input_tokens,
        usage.output_tokens,
        getattr(usage, "cache_creation_input_tokens", None) or 0,
        getattr(usage, "cache_read_input_tokens", None) or 0,
    )


async def complete(
    *,
    model: str,
    system: str | list[SystemBlock],
    messages: list[dict[str, str]],
    max_tokens: int,
    temperature: float,
    response_format: Literal["text", "json"] = "text",
) -> CompletionResult:
    client = _get_client()
    effective_system = system
    if response_format == "json":
        json_instruction = "\n\nReturn ONLY valid JSON. No markdown, no prose, no code fences."
        if isinstance(system, str):
            effective_system = system + json_instruction
        else:
            # Append as a small, non-cacheable trailing block rather than
            # mutating a cacheable block's text (would bust the cache key).
            effective_system = [*system, SystemBlock(text=json_instruction)]

    resp = await client.messages.create(
        model=model,
        system=_render_system(effective_system),  # type: ignore[arg-type]
        max_tokens=max_tokens,
        temperature=temperature,
        messages=messages,  # type: ignore[arg-type]
    )

    text_parts: list[str] = []
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text_parts.append(block.text)  # type: ignore[attr-defined]

    tokens_in, tokens_out, cache_creation, cache_read = _usage_ints(resp.usage)
    return CompletionResult(
        text="".join(text_parts).strip(),
        model=model,
        provider="anthropic",
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cache_creation_tokens=cache_creation,
        cache_read_tokens=cache_read,
    )


async def stream(
    *,
    model: str,
    system: str | list[SystemBlock],
    messages: list[dict[str, str]],
    max_tokens: int,
    temperature: float,
    on_usage: Callable[[CompletionUsage], None] | None = None,
) -> AsyncIterator[str]:
    """Streams text chunks. If `on_usage` is given, it's called once at the
    end of the stream with the final token/cache usage — the tutor pipeline
    uses this to record accurate cost telemetry instead of the char-count
    estimate it has to fall back to otherwise."""
    client = _get_client()
    async with client.messages.stream(
        model=model,
        system=_render_system(system),  # type: ignore[arg-type]
        max_tokens=max_tokens,
        temperature=temperature,
        messages=messages,  # type: ignore[arg-type]
    ) as s:
        async for text in s.text_stream:
            yield text
        if on_usage is not None:
            final = await s.get_final_message()
            tokens_in, tokens_out, cache_creation, cache_read = _usage_ints(final.usage)
            on_usage(
                CompletionUsage(
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cache_creation_tokens=cache_creation,
                    cache_read_tokens=cache_read,
                )
            )
