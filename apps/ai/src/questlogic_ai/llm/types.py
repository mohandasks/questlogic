"""Shared dataclasses to keep client.py and provider modules cycle-free."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CompletionResult:
    text: str
    model: str
    provider: str
    tokens_in: int
    tokens_out: int
    # Populated when the call used prompt caching (see llm/pricing.py for the
    # rate multipliers). Zero for calls that don't set a cache_control block.
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0


@dataclass
class SystemBlock:
    """One block of a multi-part system prompt.

    `cacheable=True` sets an Anthropic `cache_control: {type: "ephemeral"}`
    breakpoint on this block, so everything up to and including it is served
    from cache on subsequent calls that resend the identical prefix (e.g. the
    same lecture transcript across every turn of a tutoring session).
    """

    text: str
    cacheable: bool = False
