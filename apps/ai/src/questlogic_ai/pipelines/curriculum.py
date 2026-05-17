"""Curriculum generation pipeline.

Asks the model to produce a small skill-tree DAG for (subject, topic, depth).
Returns a strict JSON shape matching CurriculumTemplateSpec on the web side.

Risk: hallucinated prereqs (cycles, missing nodes). We validate the DAG after
generation and retry once on failure.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

from pydantic import BaseModel, Field, ValidationError

from ..llm import ModelTier, get_client
from ..llm.client import CompletionRequest
from ..llm.pricing import cost_micros
from ..db import record_llm_call

log = logging.getLogger(__name__)


class GeneratedNode(BaseModel):
    slug: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=600)
    prerequisites: list[str] = Field(default_factory=list)
    content: dict = Field(default_factory=dict)
    estimated_minutes: int | None = None


class GeneratedTemplate(BaseModel):
    topic: str
    depth: str
    nodes: list[GeneratedNode] = Field(min_length=4, max_length=14)


@dataclass
class CurriculumResult:
    template: GeneratedTemplate
    model: str
    tokens_in: int
    tokens_out: int


SUBJECT_GUIDANCE: dict[str, str] = {
    "history": (
        "Lean on causation, primary sources, and time-period anchoring. Avoid 'memorize "
        "dates' framing. Each node should produce a transferable historical-thinking skill, "
        "not just a fact list."
    ),
    "economics": (
        "Build from micro fundamentals up. Use concrete worked examples (markets, prices, "
        "incentives) before any formal modeling. Flag assumptions explicitly. Avoid math "
        "beyond intro algebra for the intro tier."
    ),
    "philosophy": (
        "Treat each node as an argument or method, not a 'school of thought summary'. "
        "Use the Socratic move where possible: present a position, then its strongest "
        "objection, then a response."
    ),
}


SYSTEM_PROMPT = """You are a curriculum architect for QuestLogic, a gamified
AI tutoring product. Given a SUBJECT, TOPIC, and DEPTH, produce a small skill
tree (4–10 nodes) the learner will progress through. Output strict JSON ONLY,
matching this TypeScript shape:

interface Out {
  topic: string;
  depth: "intro" | "intermediate" | "advanced";
  nodes: Array<{
    slug: string;            // kebab-case, unique within tree, no spaces
    title: string;           // <= 60 chars, human-readable
    summary: string;         // 1–2 sentences explaining what the learner can DO after mastering this
    prerequisites: string[]; // slugs of other nodes in this tree; [] means entry node
    content?: object;        // optional subject-specific data (timeline, schools, etc.)
    estimated_minutes?: number; // 5–45
  }>;
}

Rules:
- At least 1 entry node (prerequisites: []).
- The graph MUST be a DAG. No cycles. Prereqs reference slugs that exist.
- Nodes should ladder: each later node builds on earlier ones.
- Last 1–2 nodes should be capstone-style ("apply it" or "evaluate it").
- Slugs are kebab-case, ASCII, <= 50 chars.
"""


def _build_user_prompt(subject_slug: str, topic: str, depth: str) -> str:
    guidance = SUBJECT_GUIDANCE.get(subject_slug, "")
    return (
        f"SUBJECT: {subject_slug}\n"
        f"TOPIC: {topic}\n"
        f"DEPTH: {depth}\n\n"
        f"Subject-specific guidance:\n{guidance}\n\n"
        f"Generate the skill tree now."
    )


async def generate_curriculum(
    *, user_id: str, subject_slug: str, topic: str, depth: str
) -> CurriculumResult:
    client = get_client()
    req = CompletionRequest(
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _build_user_prompt(subject_slug, topic, depth)}],
        tier=ModelTier.CURRICULUM,
        max_tokens=2048,
        temperature=0.4,
        response_format="json",
    )

    last_err: Exception | None = None
    for attempt in range(2):
        t0 = time.monotonic()
        try:
            result = await client.complete(req)
            latency_ms = int((time.monotonic() - t0) * 1000)

            data = json.loads(_strip_code_fence(result.text))
            template = GeneratedTemplate.model_validate(data)
            _validate_dag(template)

            await record_llm_call(
                user_id=user_id,
                session_id=None,
                pipeline="curriculum",
                model=result.model,
                provider=result.provider,
                tokens_in=result.tokens_in,
                tokens_out=result.tokens_out,
                cost_micros=cost_micros(result.model, result.tokens_in, result.tokens_out),
                latency_ms=latency_ms,
                succeeded=True,
            )
            return CurriculumResult(
                template=template,
                model=result.model,
                tokens_in=result.tokens_in,
                tokens_out=result.tokens_out,
            )
        except (json.JSONDecodeError, ValidationError, ValueError) as e:
            last_err = e
            log.warning("Curriculum generation attempt %d failed: %s", attempt + 1, e)
            req.messages.append(
                {
                    "role": "assistant",
                    "content": "I produced invalid output. I will retry with strict JSON.",
                }
            )
            req.messages.append(
                {
                    "role": "user",
                    "content": (
                        "Your previous response failed validation: "
                        f"{e}. Re-emit valid JSON only, matching the schema."
                    ),
                }
            )
            continue

    assert last_err is not None
    raise last_err


def _strip_code_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        # ```json ... ```  or ``` ... ```
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s.rsplit("```", 1)[0]
    return s.strip()


def _validate_dag(t: GeneratedTemplate) -> None:
    slugs = {n.slug for n in t.nodes}
    if len(slugs) != len(t.nodes):
        raise ValueError("duplicate node slugs")
    entries = [n for n in t.nodes if not n.prerequisites]
    if not entries:
        raise ValueError("no entry nodes")
    # Check all prereqs reference existing slugs and no node depends on itself.
    for n in t.nodes:
        for p in n.prerequisites:
            if p == n.slug:
                raise ValueError(f"node {n.slug} depends on itself")
            if p not in slugs:
                raise ValueError(f"node {n.slug} references unknown prereq {p}")
    # Cycle check via DFS.
    graph = {n.slug: list(n.prerequisites) for n in t.nodes}
    WHITE, GRAY, BLACK = 0, 1, 2
    state = dict.fromkeys(graph, WHITE)

    def visit(node: str) -> None:
        state[node] = GRAY
        for nb in graph[node]:
            if state[nb] == GRAY:
                raise ValueError(f"cycle detected at {node} -> {nb}")
            if state[nb] == WHITE:
                visit(nb)
        state[node] = BLACK

    for n in graph:
        if state[n] == WHITE:
            visit(n)
