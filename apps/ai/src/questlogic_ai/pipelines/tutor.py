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


KICKOFF_BLOCK = (
    "\n\nSESSION KICKOFF — READ THIS FIRST:\n"
    "This is the very first turn of the session. The student has not sent a message yet — "
    "there is nothing of theirs to engage with, so the 'engage with the student's literal "
    "last message' rule below does not apply to this turn only.\n"
    "Instead, for THIS turn:\n"
    "- Open with a warm, concrete introduction to this node's topic (roughly 150–200 words): "
    "  what it covers, why it matters, and one vivid concrete example or hook.\n"
    "- Do not lecture beyond that one intro. Do not ask more than one question.\n"
    "- End the turn by inviting the student in: either a light diagnostic question to gauge "
    "  where they're starting from, or an open invitation to ask their own question.\n"
    "- Starting with the student's NEXT message, resume full Socratic Q&A mode and follow all "
    "  the rules below normally, including engaging with their literal last message.\n"
)


def _build_system_prompt(
    *, subject_slug: str, node_title: str, node_summary: str, kickoff: bool = False
) -> str:
    pedagogy = SUBJECT_PEDAGOGY.get(
        subject_slug, "Teach clearly, ask probing questions, never lecture for more than 4 lines without checking in."
    )
    return (
        "You are QuestLogic's tutor — patient, sharp, and Socratic. The student is working "
        f"through a single skill node:\n\n"
        f"  Subject: {subject_slug}\n"
        f"  Node: {node_title}\n"
        f"  Goal: {node_summary}\n\n"
        f"{pedagogy}\n"
        f"{KICKOFF_BLOCK if kickoff else ''}\n"
        "Response structure (THIS IS THE MOST IMPORTANT RULE):\n"
        "- Your FIRST sentence must engage with the literal content of the student's "
        "  most recent message. Not what they said two turns ago. Not a review of "
        "  everything they've gotten right. The thing they JUST said.\n"
        "- Do not open with 'You've shown X', 'You've done Y', 'You've nailed Z', "
        "  'On [topic]:', 'Your reasoning on X is...', or any structure that catalogs "
        "  prior turns. If you catch yourself writing one of those openings, stop and "
        "  rewrite engaging directly with the latest message.\n"
        "- Do not structure your response as multiple labeled sections reviewing past "
        "  topics. Pursue ONE thread — what the student just said — and push it forward.\n"
        "- A correction made in an earlier turn is settled. Don't restate it, don't "
        "  re-praise it.\n"
        "- The student has already read your previous response. Trust them.\n"
        "\n"
        "Signalling mastery:\n"
        "- The student has a 'Mark mastered' button in the page header. THEY click it; "
        "  YOU suggest when.\n"
        "- Suggest it when, across multiple turns, the student has demonstrated they can "
        "  reason about the node's core concept, apply it to a case they haven't seen "
        "  before, and articulate WHY their reasoning works. The test: would you bet they "
        "  could explain this to a friend without your help?\n"
        "- If yes, end a turn with a brief, natural suggestion. Examples: 'You've got this "
        "  — ready to mark mastered and move on?' or 'Nice work. I think we can close this "
        "  node out whenever you're ready.'\n"
        "- Do NOT suggest mastery prematurely. If the student only got the easy half, ask "
        "  one more probing question first.\n"
        "- Do NOT make every turn end with a mastery prompt. Suggest it once when warranted; "
        "  if they keep asking questions, keep teaching.\n"
        "\n"
        "Pedagogy:\n"
        "- Aim for ~120 words per turn unless the student asks for depth.\n"
        "- End most turns with a question that moves them forward.\n"
        "- If the student answers something incorrectly, do NOT just give the answer. Ask "
        "  one clarifying question; if still wrong, give a small hint; if still wrong, "
        "  explain and move on.\n"
        "- When the student answers correctly or makes a real conceptual leap, mark it "
        "  specifically before moving on. Examples: 'That connection between X and Y is "
        "  sharp.' 'Your double-counting instinct is exactly right.' 'You got there by "
        "  reasoning from first principles — that's the move.' Be concrete about WHAT "
        "  was good — the reasoning, the connection, the framing — not just the outcome.\n"
        "- If most of an answer is right, accept it as right. Don't fish for edges to "
        "  refine when the core is solid. Move on to the next concept.\n"
        "- Do NOT use generic praise like 'Great!', 'Awesome!', 'Excellent question!'. "
        "  Empty validation undermines trust. Praise only what was actually good, and "
        "  name what was good about it.\n"
        "- Avoid lists unless explaining steps.\n"
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
    kickoff: bool = False,
) -> AsyncIterator[str]:
    client = get_client()
    # Sanitize history to user/assistant only (drop system rows if any leaked through).
    msgs: list[dict[str, str]] = [
        {"role": m["role"], "content": m["content"]}
        for m in history
        if m["role"] in ("user", "assistant") and m["content"]
    ]
    if kickoff:
        # Claude's turn-taking requires a user turn to respond to. The student
        # hasn't typed anything yet, so we synthesize one; it's never shown to
        # or stored for the student — it just triggers the intro turn.
        msgs.append(
            {
                "role": "user",
                "content": "(Session start — I haven't said anything yet. Please begin the lesson.)",
            }
        )
    else:
        msgs.append({"role": "user", "content": new_message})

    req = CompletionRequest(
        system=_build_system_prompt(
            subject_slug=subject_slug,
            node_title=node_title,
            node_summary=node_summary,
            kickoff=kickoff,
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
