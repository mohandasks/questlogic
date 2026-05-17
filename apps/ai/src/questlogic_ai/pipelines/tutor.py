"""Tutor pipeline. Streams a response one node at a time, grounded in:
- the node the student is working on,
- the subject's pedagogy preferences,
- the last N turns of the session.

No tools, no retrieval in v0. Memory beyond the visible window is a follow-up
slice that will read from user_memory_chunks.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

from ..db import record_llm_call
from ..llm import ModelTier, get_client
from ..llm.client import CompletionRequest
from ..llm.pricing import cost_micros


SUBJECT_PEDAGOGY: dict[str, str] = {
    "history": (
        "When teaching history, anchor in time and place first. Use primary-source quotes "
        "when appropriate. Push toward causal reasoning rather than dates. Ask the student "
        "what they already think before correcting; let them reason out loud."
    ),
    "economics": (
        "When teaching economics, prefer concrete examples to formal models. Always name the "
        "actors, the incentives, and the constraints. If a student offers a market intuition, "
        "test it with a counterfactual rather than declaring it wrong."
    ),
    "philosophy": (
        "When teaching philosophy, never collapse a view into a slogan. Present positions in "
        "their strongest form (steel-man), then the strongest objection. Use the Socratic move: "
        "ask short questions, follow the student's reasoning, and only state your own view when "
        "asked or when needed to break a confusion."
    ),
}


def _build_system_prompt(*, subject_slug: str, node_title: str, node_summary: str) -> str:
    pedagogy = SUBJECT_PEDAGOGY.get(
        subject_slug, "Teach clearly, ask probing questions, never lecture for more than 4 lines without checking in."
    )
    return (
        "You are QuestLogic's tutor — patient, sharp, and Socratic. The student is working "
        f"through a single skill node:\n\n"
        f"  Subject: {subject_slug}\n"
        f"  Node: {node_title}\n"
        f"  Goal: {node_summary}\n\n"
        f"{pedagogy}\n\n"
        "Rules of engagement:\n"
        "- Aim for ~150 words per turn unless the student asks for depth.\n"
        "- End most turns with a question that moves them forward.\n"
        "- If the student answers something incorrectly, do NOT just give the answer. Ask "
        "  one clarifying question, then if still wrong, give a small hint, then if still "
        "  wrong, explain and move on.\n"
        "- Avoid filler phrases. Avoid lists unless explaining steps.\n"
        "- Never break character as a tutor."
    )


async def stream_tutor_reply(
    *,
    user_id: str,
    session_id: str,
    subject_slug: str,
    node_title: str,
    node_summary: str,
    history: list[dict[str, str]],
    new_message: str,
) -> AsyncIterator[str]:
    client = get_client()
    # Sanitize history to user/assistant only (drop system rows if any leaked through).
    msgs: list[dict[str, str]] = [
        {"role": m["role"], "content": m["content"]}
        for m in history
        if m["role"] in ("user", "assistant") and m["content"]
    ]
    msgs.append({"role": "user", "content": new_message})

    req = CompletionRequest(
        system=_build_system_prompt(
            subject_slug=subject_slug, node_title=node_title, node_summary=node_summary
        ),
        messages=msgs,
        tier=ModelTier.TUTOR_QUALITY,
        max_tokens=900,
        temperature=0.7,
    )

    t0 = time.monotonic()
    streamed_chars = 0
    tokens_in_estimate = sum(len(m["content"]) for m in msgs) // 4 + 200  # rough
    succeeded = True
    error_class: str | None = None

    try:
        async for chunk in client.stream(req):
            streamed_chars += len(chunk)
            yield chunk
    except Exception as e:  # noqa: BLE001
        succeeded = False
        error_class = type(e).__name__
        raise
    finally:
        latency_ms = int((time.monotonic() - t0) * 1000)
        tokens_out_estimate = streamed_chars // 4
        model = client.model_for(ModelTier.TUTOR_QUALITY)
        await record_llm_call(
            user_id=user_id,
            session_id=session_id,
            pipeline="tutor",
            model=model,
            provider="anthropic",
            tokens_in=tokens_in_estimate,
            tokens_out=tokens_out_estimate,
            cost_micros=cost_micros(model, tokens_in_estimate, tokens_out_estimate),
            latency_ms=latency_ms,
            succeeded=succeeded,
            error_class=error_class,
        )
