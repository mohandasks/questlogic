# QuestLogic — Curated Subjects Design

A design for supporting fixed, source-grounded courses (PDF lecture transcripts + assignments, organized by week) alongside the existing freeform, LLM-generated quests. Written against the as-built system in `QuestLogic_AsBuilt_Architecture.md` — it extends what's there rather than proposing a parallel stack.

---

## 1. Framing

Today's tutor pipeline is deliberately generative: the LLM invents the curriculum (`curriculum.py`) and teaches from its own knowledge (`tutor.py`), Socratically. Curated subjects invert both of those defaults:

- **Curriculum is fixed**, not generated — it comes from a real course's week/lecture structure.
- **Teaching content is grounded**, not invented — the tutor should draw from the actual transcript, not its own training knowledge, and say so when it's stepping outside the material.
- **Pedagogy shifts**, from Socratic discovery to guided instruction (design in §4) — because the goal is "learn this specific lecture," not "reason your way to a concept."

The design goal below is to get this by **reusing the existing quest/node/session machinery** (skill-tree list, node_progress, chat streaming, sharing) rather than building a second product next to it. A curated course becomes, mechanically, a quest instantiated from a special kind of template.

---

## 2. Data model

Extend the existing `curriculum_templates` → `template_nodes` → `template_edges` graph rather than forking it. Everything downstream (quests, node_progress, sessions, messages, skill-tree UI) keeps working unmodified.

```sql
-- Extend the existing template row, not replace it.
ALTER TABLE curriculum_templates
  ADD COLUMN source_type text NOT NULL DEFAULT 'generated'
    CHECK (source_type IN ('generated', 'curated')),
  ADD COLUMN pedagogy_style text NOT NULL DEFAULT 'socratic'
    CHECK (pedagogy_style IN ('socratic', 'guided')),
  ADD COLUMN course_metadata jsonb NOT NULL DEFAULT '{}'::jsonb; -- institution, term, instructor, etc.

-- One row per lecture's extracted source material, 1:1 with a template_node.
CREATE TABLE curated_lecture_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_node_id uuid NOT NULL UNIQUE REFERENCES template_nodes(id) ON DELETE CASCADE,
  week_number     int NOT NULL,
  lecture_number  int NOT NULL DEFAULT 1,       -- for weeks with multiple lectures
  original_pdf_path text,                        -- object storage key, for provenance/"view original"
  raw_text        text NOT NULL,                 -- cleaned, extracted transcript
  token_count     int NOT NULL,
  checksum        text NOT NULL,                 -- hash of the source PDF; drives re-ingestion
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,                    -- null = not yet human-approved
  reviewed_by     uuid REFERENCES app.users(id)
);

CREATE INDEX curated_lecture_sources_node_idx ON curated_lecture_sources(template_node_id);

-- Optional per-lecture assignment. Not auto-graded in v1 (see §5).
CREATE TABLE curated_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_node_id uuid NOT NULL REFERENCES template_nodes(id) ON DELETE CASCADE,
  title           text NOT NULL,
  instructions    text NOT NULL,                 -- extracted from the assignment PDF
  original_pdf_path text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Optional: chunk + embed only for lectures long enough to need retrieval (see §4.3).
CREATE TABLE curated_lecture_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid NOT NULL REFERENCES curated_lecture_sources(id) ON DELETE CASCADE,
  chunk_index     int NOT NULL,
  content         text NOT NULL,
  embedding       vector(1024),                  -- see §4.3 on picking a real embedding model/dim
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX curated_lecture_chunks_embedding_idx
  ON curated_lecture_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
```

Why extend rather than fork: `template_edges` already models prerequisites, so week-over-week ordering is just a linear chain of edges generated at ingestion time (week N → week N+1). `node_progress`, `sessions`, `messages`, sharing, and `skill-tree-list.tsx` need **zero changes** — they operate on `template_node_id` and don't care whether the node came from an LLM or a PDF.

Curated courses are not forced into the existing `subjects` enum (history/economics/philosophy) — `course_metadata` on the template carries course-specific identity (institution, term, instructor, course code), and the browse UI in §6 lists courses directly rather than nesting them under a subject.

---

## 3. Ingestion pipeline

Curated content is authored by the QuestLogic team, not end users — this is an offline/admin pipeline, not a live product feature.

**Input convention:** a course directory per curated course, PDFs organized by week:

```
courses/cs229-intro-ml/
  course.yaml              # title, description, instructor, term
  week-01/lecture-1.pdf
  week-01/assignment.pdf   # optional
  week-02/lecture-1.pdf
  week-02/lecture-2.pdf    # multi-lecture weeks supported
  ...
```

**Pipeline (script, run by a curator — `apps/ai/scripts/ingest_course.py` or similar, not an HTTP endpoint):**

1. **Extract text** from each PDF (e.g. `pdfplumber` or `pymupdf`). Assumes text-based PDFs — scanned/image-only transcripts need OCR first, which is out of scope for v1 (flag and skip with a warning rather than silently ingesting garbage).
2. **Clean**: strip running headers/footers/page numbers, fix PDF-extraction hyphenation artifacts, collapse whitespace.
3. **Diff by checksum**: hash the raw PDF; skip re-ingestion if unchanged. If changed, bump `curriculum_templates.version` the same way the generated-curriculum path already does — active quests stay pinned to their version, exactly per the existing versioning rule in the schema doc.
4. **Create/update the template graph**: one `curriculum_templates` row (`source_type='curated'`, `status='draft'`), one `template_nodes` row per lecture (title/summary can be LLM-drafted from the transcript in a single cheap one-time call — Haiku is fine here, since this text is reviewed by a human before going live, not shown live to students), linear `template_edges` week-to-week (explicit override supported via `course.yaml` if ordering isn't strictly linear).
5. **Store the source**: `raw_text` into `curated_lecture_sources`, original PDF into object storage (needed net-new — see §7) for provenance and an optional "view original slides" link in the UI.
6. **Assignments**: if `assignment.pdf` is present in a week folder, extract and store into `curated_assignments`, linked to that week's node.
7. **Human review gate**: template stays `status='draft'` until a curator flips it to `active` (CLI flag or a minimal admin toggle) — deliberately manual, because "follow the material closely" only works if the extracted text and generated node titles are actually correct, and no one is watching this run unattended the way generated-quest output is.

---

## 4. Teaching pipeline: guided mode

### 4.1 New `pedagogy_style` dimension

Add `pedagogy_style` (`socratic` | `guided`) at the template level, defaulting to `guided` for curated courses and `socratic` for generated quests, with room to override per course later (e.g. a curated philosophy seminar might want Socratic discussion sections even though the source is fixed — this is a spectrum, not a hard binary, so keep it as a simple enum now rather than over-building a config system before there's a second real use case for it).

`tutor.py` picks the system prompt builder by `pedagogy_style` instead of always using the current Socratic one. The existing Socratic prompt (confidence-reading, hard cap on probing loops, etc.) is untouched and stays the default for generated quests.

### 4.2 Guided-mode system prompt — design

Core behavioral differences from Socratic mode:

- **Source-grounded, explicitly.** The lecture transcript for the current node is injected as a clearly labeled, authoritative block: *"SOURCE MATERIAL — this is the actual lecture transcript for this session. Teach from this. Do not introduce facts, frameworks, or examples that aren't here unless the student explicitly asks to go beyond the lecture."* This is the mechanism that makes "follow the material as closely as possible" enforceable rather than aspirational.
- **Explain-then-check, not ask-then-discover.** Default posture is direct instruction that follows the transcript's own sequence of ideas, with comprehension checks at natural breakpoints ("does that follow?" / a quick recall question) rather than open Socratic probing. This is the "less Socratic, more pedagogical" shift requested — concretely, replace the Socratic prompt's "ask a probing question, wait for the student to reason it out" default with "explain the next chunk of material, then confirm understanding before moving on."
- **Cite the source.** When explaining a concept, the tutor should anchor it to the lecture ("as this lecture puts it...", "picking up where the lecture left off on X...") — both for pedagogical trust and because it makes drift from the source material easy for a reviewer to catch by spot-check.
- **Explicit boundary handling on off-material questions.** If a student asks something the transcript doesn't cover, the tutor says so plainly and offers a choice — e.g. *"This lecture doesn't get into that. Want me to answer briefly from general knowledge (and flag that it's outside the course material), or stay focused on what's here?"* — rather than silently blending outside knowledge into a "grounded" answer. This is the single most important behavioral rule in the whole design; it's the difference between "grounded" and "grounded until it's inconvenient."
- **Pacing follows the transcript, not the student's tangents by default.** The tutor tracks roughly where in the lecture it is and moves forward through it, rather than letting one interesting side-question consume the whole session — while still answering the question asked.

### 4.3 Grounding mechanism: inject first, retrieve only if needed

Sonnet's context window (1M tokens) comfortably fits a full lecture transcript — a dense hour-long lecture is roughly 8,000–15,000 words (~11,000–20,000 tokens). **Default approach: inject the full transcript for the current node into the system prompt.** No embeddings, no retrieval, no new infra for the common case — this matches the existing system's "boring infra" bias and avoids standing up a vector pipeline for content that fits in context anyway.

**Fall back to chunking + retrieval (`curated_lecture_chunks`, already modeled in §2) only when a single lecture's transcript exceeds a size threshold** (e.g. ~40K tokens) or when a student's question plausibly spans multiple prior weeks ("how does this connect to what we covered in week 3?") — that's a real retrieval need, not a context-fitting problem, and justifies the added complexity only there. This needs an embedding provider, since Anthropic doesn't offer one — Voyage AI is Anthropic's recommended partner. Whatever model is picked, size `curated_lecture_chunks.embedding` to its actual output dimension; don't assume 1536 (ada-002/text-embedding-3-small size) the way the existing `user_memory_chunks` table does, since most current embedding models don't use that dimension.

### 4.4 Cost control: prompt caching

Injecting a full transcript every turn, uncached, would make curated tutoring meaningfully more expensive per turn than generated tutoring (see §7 for numbers) — the transcript is identical across every turn in a session on that node, which is exactly what Anthropic's prompt caching is for. Structure the system prompt as: [stable instructions] → [cache breakpoint] → [transcript block, cached] → [node metadata]. This requires a small addition to `anthropic_provider.complete`/`stream` to set a `cache_control` breakpoint on the transcript block — not currently used anywhere in the codebase, worth adding here regardless of curated subjects since it would also cut cost on the existing tutor system prompt (see the as-built doc's cost section — that prompt is resent in full every turn today with no caching).

---

## 5. Assignments

V1 scope is deliberately light — no auto-grading, since the assessment/grading pipeline doesn't exist yet anywhere in the codebase (per the as-built doc, `template_assessments`/`assessment_attempts`/`grade_runs` are schema-only today):

- Assignment instructions surface on the lecture's node page as a distinct panel (not mixed into chat).
- The tutor can discuss the assignment in guided mode using the same grounding discipline — explain relevant lecture concepts on request — but is instructed not to simply produce the answer outright; nudge toward the work rather than complete it, without going full Socratic about it.
- Completion is self-reported for now: a "Mark assignment reviewed" action, distinct from node "mastery," which continues to mean "understood the lecture material."
- If/when the assessment pipeline gets built, `curated_assignments` slots in as the source for `template_assessments` rows with minimal rework — this is a deliberate seam, not a dead end.

---

## 6. UI / routes

New top-level surface, parallel to the existing quest flow, not nested inside it:

- **Home page**: add a **Curated** entry point alongside the existing "My Quests" / "New Quest" — a distinct section, not a subject filter, since curated courses aren't part of the history/economics/philosophy subject set.
- **`/curated`** — browse curated courses: cards showing title, instructor/term, week count, short description. Pulled from `curriculum_templates WHERE source_type='curated' AND status='active'`.
- **`/curated/[courseSlug]`** — course detail: weeks/lectures in order, reusing `skill-tree-list.tsx` (it already renders node status — locked/available/mastered — off `node_progress`, which needs no changes). A "Start course" action instantiates a `quests` row directly from the fixed template — no topic/depth form, since both are already fixed by the course.
- **`/curated/[courseSlug]/lectures/[lectureId]`** — same chat surface as the existing node page (`chat-window.tsx`/`chat-bubble.tsx` unchanged), running in guided mode. Adds two things the generated-quest node page doesn't need: a collapsible "Lecture material" panel (transcript, or original PDF link) and an "Assignment" panel when one exists for that node.
- Sharing (`/share/[slug]`) works unmodified — it already operates on sessions, not on how the underlying template was produced.

No new auth model, no new session/message plumbing — the surface area is genuinely just: two browse pages, a reused chat page with two extra side panels, and a "Curated" link on the home page.

---

## 7. Cost impact

Using the same method as the as-built doc's cost section (current Sonnet 4.6 pricing, $3/$15 per M tokens):

| Scenario | Input tokens/turn | Cost/turn |
|---|---|---|
| Generated quest, steady-state (today) | ~1,600 | ~$0.008 |
| Curated lecture, full transcript injected, **uncached** | ~1,600 (prompt) + ~12,000 (transcript) ≈ 13,600 | ~$0.043 |
| Curated lecture, full transcript injected, **cached** (after first turn) | ~1,600 (prompt) + ~12,000 × 0.1 (cache read ≈ 90% off) ≈ 2,800 | ~$0.011 |

Uncached, a curated-lecture session is roughly **5× more expensive per turn** than a generated quest — cached, after the first turn in a session, it's much closer to parity (~1.4×, since the transcript itself still contributes a small residual cost even from cache, and output tokens are unchanged). Prompt caching here isn't an optimization, it's close to a requirement — without it, curated courses would dominate the cost-per-active-user metric in a way that's disproportionate to their pedagogical value over generated quests.

Assignment discussion turns cost about the same as regular guided turns (same transcript context); ingestion costs are one-time and small (~$0.01–0.03 per lecture for the title/summary drafting call, paid once at curation time, not per student).

---

## 8. Phased rollout

**V1 (this design):**
- Schema extension (§2), CLI ingestion script (§3), guided-mode prompt (§4.2), full-transcript injection with caching (§4.3–4.4), assignment display without grading (§5), `/curated` browse + course + lecture pages (§6).

**Deliberately deferred:**
- Auto-graded assignments (waits on the assessment pipeline).
- OCR for scanned PDFs.
- Any admin *UI* for upload/review — v1 review is a CLI flag flipped by a curator, not a web form.
- Chunked retrieval / embeddings (§4.3) — only build this when a real course has a lecture too long to fit in context, or a cross-week question need shows up in practice.
- Per-course Socratic/guided tuning beyond the two presets — revisit if a curated course's subject matter genuinely wants discussion-style teaching.

---

## 9. Open decisions to make before building

1. **Embedding provider**, if/when §4.3's fallback is needed — Voyage AI is the reasonable default given the Anthropic-first stack, but this is a new vendor dependency worth deciding deliberately, not defaulting into.
2. **Object storage** for original PDFs (§3, step 5) — nothing in the current stack does this yet; Cloudflare R2 was already the pick in the target-state design doc for user uploads, so this is a natural first real use of it.
3. **Multi-lecture weeks and non-linear prerequisites** — the linear week-to-week edge default covers most courses; confirm whether any launch course actually needs a non-linear graph (e.g. two independent lecture tracks converging) before building override support beyond the `course.yaml` escape hatch in §3.
