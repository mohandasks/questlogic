"""Drafts a node title + summary from a lecture transcript, one cheap LLM call
per lecture, run once at ingestion time (not shown live to students until a
curator reviews and publishes) — see design doc §3 step 4.
"""

from __future__ import annotations

import json
import logging

from pydantic import BaseModel, ValidationError

from ..llm import ModelTier, get_client
from ..llm.client import CompletionRequest

log = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are drafting a catalog entry for one lecture in a course, from its
transcript. Output strict JSON ONLY, matching this shape:

{"title": "<= 80 chars, human-readable lecture title", "summary": "1-2 sentences describing what the lecture covers"}

Base the title and summary only on the transcript given. Do not invent content beyond it."""

# Only the opening portion is needed to draft a title/summary — keeps this
# cheap and fast even for a long transcript.
_MAX_TRANSCRIPT_CHARS_FOR_DRAFTING = 8000


class _Draft(BaseModel):
    title: str
    summary: str


async def draft_title_and_summary(transcript: str, *, fallback_title: str) -> tuple[str, str]:
    client = get_client()
    excerpt = transcript[:_MAX_TRANSCRIPT_CHARS_FOR_DRAFTING]
    req = CompletionRequest(
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"TRANSCRIPT EXCERPT:\n\n{excerpt}"}],
        tier=ModelTier.CHEAP,
        max_tokens=300,
        temperature=0.3,
        response_format="json",
    )
    try:
        result = await client.complete(req)
        data = json.loads(_strip_code_fence(result.text))
        draft = _Draft.model_validate(data)
        return draft.title.strip(), draft.summary.strip()
    except (json.JSONDecodeError, ValidationError, ValueError) as e:
        log.warning("Title/summary drafting failed, falling back to filename: %s", e)
        return fallback_title, "Summary not yet reviewed — drafted from filename only."


def _strip_code_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s.rsplit("```", 1)[0]
    return s.strip()
