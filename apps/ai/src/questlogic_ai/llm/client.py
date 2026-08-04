"""Provider-agnostic LLM client.

Today: only Anthropic is wired. Adding OpenAI or Gemini is a matter of (a)
implementing a new provider module mirroring `anthropic_provider.py` and (b)
mapping a `ModelTier` to its model id here. The pipelines never name a
specific model — they ask for a tier.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import AsyncIterator, Callable, Literal

from ..settings import settings
from . import anthropic_provider
from .anthropic_provider import CompletionUsage
from .types import CompletionResult, SystemBlock

__all__ = [
    "LlmClient",
    "ModelTier",
    "CompletionRequest",
    "CompletionResult",
    "SystemBlock",
    "CompletionUsage",
    "get_client",
]


class ModelTier(str, Enum):
    TUTOR_FAST = "tutor-fast"
    TUTOR_QUALITY = "tutor-quality"
    CURRICULUM = "curriculum"
    CHEAP = "cheap"


@dataclass
class CompletionRequest:
    # A plain string for the common case; a list of SystemBlocks when part of
    # the prompt (e.g. a lecture transcript) should be cached across calls —
    # see SystemBlock in llm/types.py.
    system: str | list[SystemBlock]
    messages: list[dict[str, str]]
    tier: ModelTier
    max_tokens: int = 1024
    temperature: float = 0.7
    response_format: Literal["text", "json"] = "text"


class LlmClient:
    def _resolve_model(self, tier: ModelTier) -> str:
        if tier == ModelTier.TUTOR_QUALITY:
            return settings.model_tutor
        if tier == ModelTier.CURRICULUM:
            return settings.model_curriculum
        return settings.model_cheap

    async def complete(self, req: CompletionRequest) -> CompletionResult:
        model = self._resolve_model(req.tier)
        return await anthropic_provider.complete(
            model=model,
            system=req.system,
            messages=req.messages,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
            response_format=req.response_format,
        )

    async def stream(
        self,
        req: CompletionRequest,
        *,
        on_usage: Callable[[CompletionUsage], None] | None = None,
    ) -> AsyncIterator[str]:
        model = self._resolve_model(req.tier)
        async for chunk in anthropic_provider.stream(
            model=model,
            system=req.system,
            messages=req.messages,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
            on_usage=on_usage,
        ):
            yield chunk

    def model_for(self, tier: ModelTier) -> str:
        return self._resolve_model(tier)


_client: LlmClient | None = None


def get_client() -> LlmClient:
    global _client
    if _client is None:
        _client = LlmClient()
    return _client
