"""Tutor pipeline. Streams a response one node at a time.

Two pedagogy styles, chosen per curriculum_templates.pedagogy_style:

- "socratic" (default, generated quests): the model teaches from its own
  knowledge, grounded only in the node title/summary the curriculum pipeline
  invented. Ask-then-discover.
- "guided" (curated courses): the model teaches from an actual lecture
  transcript passed in by the caller, explain-then-check, and is instructed
  to flag rather than fill in anything the transcript doesn't cover. See
  QuestLogic_Curated_Subjects_Design.md for the full rationale.

No tools, no retrieval in v0 beyond the transcript given for the current
node. Memory beyond the visible window is a follow-up slice that will read
from user_memory_chunks.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import Literal

from ..db import record_llm_call
from ..llm import CompletionUsage, ModelTier, SystemBlock, get_client
from ..llm.client import CompletionRequest
from ..llm.pricing import cost_micros_detailed

PedagogyStyle = Literal["socratic", "guided"]

# ---------------------------------------------------------------------------
# Socratic mode (generated quests) — unchanged from the original tutor prompt.
# ---------------------------------------------------------------------------

SUBJECT_PEDAGOGY: dict[str, str] = {
    "history": (
        "When teaching history, anchor in time and place first. Use primary-source quotes "
        "when appropriate. Push toward causal reasoning rather than dates. Ask the student "
        "what they already think before correcting; let them reason out loud — but if they "
        "clearly don't have the background facts to reason from (they're guessing or say "
        "they don't know), give them the facts directly first, then resume asking."
    ),
    "economics": (
        "When teaching economics, prefer concrete examples to formal models. Always name the "
        "actors, the incentives, and the constraints. If a student offers a market intuition, "
        "test it with a counterfactual rather than declaring it wrong — but if they have no "
        "intuition to offer yet (uncertain, guessing), explain the mechanism directly before "
        "asking them to reason about it."
    ),
    "philosophy": (
        "When teaching philosophy, never collapse a view into a slogan. Present positions in "
        "their strongest form (steel-man), then the strongest objection. Use the Socratic move "
        "when the student has enough on the table to reason with: ask short questions, follow "
        "their reasoning, and state your own view when asked or when needed to break a "
        "confusion. When they don't have enough on the table yet — they're guessing or "
        "hedging — the Socratic move is the wrong tool; tell them what the text/position "
        "actually says or does, then resume questioning from that firmer footing."
    ),
}


SOCRATIC_KICKOFF_BLOCK = (
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


def _build_socratic_system_prompt(
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
        f"{SOCRATIC_KICKOFF_BLOCK if kickoff else ''}\n"
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
        "- Read the student's confidence before deciding your move — this is the single "
        "  most important judgment call you make each turn:\n"
        "  * CONFIDENT and correct: affirm specifically, then push to the next layer with "
        "    a real question.\n"
        "  * CONFIDENT and wrong: don't just give the answer. Ask one clarifying question; "
        "    if still wrong, give a small hint; if still wrong, explain and move on.\n"
        "  * UNCERTAIN: hedging language ('I don't think', 'I'm not sure', 'hmm'), a guess "
        "    floated as a question, or a short noncommittal answer. This is the student "
        "    telling you they don't have enough on the table to reason further — another "
        "    probing question just stalls them and burns their patience. Do NOT volley back "
        "    with a question. Instead, directly explain the actual answer, concretely and "
        "    concisely (2-5 sentences), grounded in whatever example is already in play. A "
        "    student who says 'I don't know' or answers with a shrug should get taught, not "
        "    quizzed again.\n"
        "  * Hard cap on Socratic loops: if you've asked two probing questions in a row on "
        "    the same sub-point without the student converging on a clear, confident answer, "
        "    stop probing — explain it yourself on the third turn instead of asking a third "
        "    question. Never let a single point stretch past that, even if the student seems "
        "    willing to keep guessing.\n"
        "- A turn spent on direct explanation doesn't need to close with a big forward-moving "
        "  question — a light comprehension check ('make sense?') or simply moving on to the "
        "  next idea is fine. Save the real, effortful forward-pushing questions for moments "
        "  where the student has just shown they can carry one.\n"
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


# ---------------------------------------------------------------------------
# Guided mode (curated courses) — explain-then-check, grounded in a real
# transcript. See QuestLogic_Curated_Subjects_Design.md §4.2 for the design
# rationale behind each rule below.
# ---------------------------------------------------------------------------

GUIDED_KICKOFF_BLOCK = (
    "\n\nSESSION KICKOFF — READ THIS FIRST:\n"
    "This is the very first turn of the session; the student hasn't said anything yet.\n"
    "For THIS turn only:\n"
    "- Open by walking into the start of the lecture material below — a short, warm framing "
    "  of what this lecture covers and why it matters (roughly 150–200 words), then begin "
    "  actually teaching its first real idea.\n"
    "- End the turn with a light comprehension check on that first idea, or an invitation to "
    "  ask a question, before moving further into the material.\n"
    "- Starting with the student's NEXT message, resume normal guided teaching per the rules "
    "  below, including engaging with their literal last message.\n"
)

GUIDED_INSTRUCTIONS = """You are QuestLogic's tutor, teaching a specific lecture from a real
course. The student is working through a single skill node:

  Node: {node_title}
  Goal: {node_summary}

The lecture transcript for this node is provided below as SOURCE MATERIAL. This is a guided
session, not a Socratic one — the job is to teach this specific lecture well, not to make the
student discover it unaided.

Grounding (THIS IS THE MOST IMPORTANT RULE):
- Teach from the SOURCE MATERIAL. Do not introduce facts, frameworks, examples, or
  terminology that aren't in it, unless the student explicitly asks you to go beyond the
  lecture.
- When you explain a concept, anchor it to the transcript ("as this lecture covers...",
  "picking up where the lecture left off on X...") so the student can tell it's grounded.
- If the student asks something the transcript doesn't cover, say so plainly and offer a
  choice — e.g. "This lecture doesn't get into that. Want me to answer briefly from general
  knowledge and flag it as outside the course material, or stay focused on what's here?" Never
  silently blend outside knowledge into what should be a grounded answer.

Teaching mode — explain, then check (not ask, then discover):
- Default posture is direct instruction that follows the transcript's own sequence of ideas.
  Walk the student through the lecture roughly in order rather than picking an arbitrary
  thread.
- After explaining a chunk of material, check understanding with something light — a quick
  recall question, "does that follow?", or a short "what would you predict happens if..." —
  rather than open-ended Socratic probing. The goal is confirmation, not discovery.
- Still answer tangents the student raises, but return to the lecture's own thread afterward
  rather than letting one question derail the whole session.
- Aim for ~120–150 words per turn unless walking through something that genuinely needs more
  room, or the student asks for depth.

Signalling mastery:
- The student has a 'Mark mastered' button in the page header. THEY click it; YOU suggest
  when.
- Suggest it once the student has been walked through the lecture's core content and shown
  they can restate or apply its main idea in their own words — not before.
- Do NOT make every turn end with a mastery prompt.

Tone:
- Do NOT use generic praise like 'Great!', 'Awesome!'. Praise only what was actually good,
  and name what was good about it.
- Avoid lists in your responses unless explaining literal steps from the material.
- Never break character as a tutor.{kickoff_block}"""


def _build_guided_system_blocks(
    *,
    node_title: str,
    node_summary: str,
    transcript: str | None,
    assignment_instructions: str | None,
    kickoff: bool,
) -> list[SystemBlock]:
    instructions = GUIDED_INSTRUCTIONS.format(
        node_title=node_title,
        node_summary=node_summary,
        kickoff_block=GUIDED_KICKOFF_BLOCK if kickoff else "",
    )
    blocks = [SystemBlock(text=instructions)]

    if transcript:
        # This is the block worth caching: it's identical across every turn of
        # a session on this node (and often large — a full lecture transcript
        # can run 10-20K tokens). cache_control here caches everything up to
        # and including this block, i.e. instructions + transcript together.
        transcript_block = (
            "\n\nSOURCE MATERIAL — this is the actual lecture transcript for this session. "
            "Teach from this; do not introduce anything outside it unless asked.\n\n"
            f"--- LECTURE TRANSCRIPT: {node_title} ---\n"
            f"{transcript}\n"
            "--- END TRANSCRIPT ---"
        )
        blocks.append(SystemBlock(text=transcript_block, cacheable=True))
    else:
        # Guided mode with no transcript ingested yet — teach from the node
        # summary only, and say so, rather than silently degrading to
        # free-generation the way Socratic mode would.
        blocks.append(
            SystemBlock(
                text=(
                    "\n\nNo transcript is on file for this lecture yet. Teach from this summary "
                    f"only, and tell the student the full material isn't loaded: {node_summary}"
                )
            )
        )

    if assignment_instructions:
        blocks.append(
            SystemBlock(
                text=(
                    "\n\nThis lecture has an assignment the student may ask about. Help them "
                    "work through it using the same grounding rules above — explain relevant "
                    "material on request, but nudge toward the work rather than completing it "
                    "for them.\n\n"
                    f"--- ASSIGNMENT ---\n{assignment_instructions}\n--- END ASSIGNMENT ---"
                )
            )
        )

    return blocks


# ---------------------------------------------------------------------------
# Shared entry point
# ---------------------------------------------------------------------------


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
    pedagogy_style: PedagogyStyle = "socratic",
    transcript: str | None = None,
    assignment_instructions: str | None = None,
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

    system: str | list[SystemBlock]
    if pedagogy_style == "guided":
        system = _build_guided_system_blocks(
            node_title=node_title,
            node_summary=node_summary,
            transcript=transcript,
            assignment_instructions=assignment_instructions,
            kickoff=kickoff,
        )
    else:
        system = _build_socratic_system_prompt(
            subject_slug=subject_slug,
            node_title=node_title,
            node_summary=node_summary,
            kickoff=kickoff,
        )

    req = CompletionRequest(
        system=system,
        messages=msgs,
        tier=ModelTier.TUTOR_QUALITY,
        max_tokens=900,
        temperature=0.7,
    )

    t0 = time.monotonic()
    succeeded = True
    error_class: str | None = None
    usage_holder: list[CompletionUsage] = []

    try:
        async for chunk in client.stream(req, on_usage=usage_holder.append):
            yield chunk
    except Exception as e:  # noqa: BLE001
        succeeded = False
        error_class = type(e).__name__
        raise
    finally:
        latency_ms = int((time.monotonic() - t0) * 1000)
        model = client.model_for(ModelTier.TUTOR_QUALITY)
        usage = usage_holder[0] if usage_holder else None
        if usage is not None:
            tokens_in, tokens_out = usage.tokens_in, usage.tokens_out
            cost = cost_micros_detailed(
                model,
                tokens_in=usage.tokens_in,
                tokens_out=usage.tokens_out,
                cache_creation_tokens=usage.cache_creation_tokens,
                cache_read_tokens=usage.cache_read_tokens,
            )
        else:
            # Stream errored before Anthropic returned final usage (e.g. the
            # request never made it out) — nothing real to report.
            tokens_in = tokens_out = 0
            cost = 0
        await record_llm_call(
            user_id=user_id,
            session_id=session_id,
            pipeline="tutor",
            model=model,
            provider="anthropic",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_micros=cost,
            latency_ms=latency_ms,
            succeeded=succeeded,
            error_class=error_class,
        )
