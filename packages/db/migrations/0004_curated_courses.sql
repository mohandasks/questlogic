-- Curated subjects: fixed, source-grounded courses (PDF lecture transcripts +
-- assignments, organized by week) alongside freeform LLM-generated quests.
-- Design: QuestLogic_Curated_Subjects_Design.md (repo root).
--
-- Extends the existing curriculum_templates -> template_nodes -> template_edges
-- graph rather than forking it, so quests, node_progress, sessions, messages,
-- and the skill-tree UI all keep working unmodified for curated courses.

-- ---------- curriculum_templates extensions ----------

ALTER TABLE curriculum_templates
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'generated',
  ADD COLUMN IF NOT EXISTS pedagogy_style text NOT NULL DEFAULT 'socratic',
  ADD COLUMN IF NOT EXISTS course_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS slug text;

DO $$ BEGIN
  ALTER TABLE curriculum_templates
    ADD CONSTRAINT curriculum_templates_source_type_check
    CHECK (source_type IN ('generated', 'curated'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE curriculum_templates
    ADD CONSTRAINT curriculum_templates_pedagogy_style_check
    CHECK (pedagogy_style IN ('socratic', 'guided'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Curated templates need a stable, human-readable URL slug (e.g.
-- 'cs229-intro-ml'); generated templates never set it. Partial unique index
-- so multiple NULLs (every generated template) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS curriculum_templates_slug_idx
  ON curriculum_templates (slug) WHERE slug IS NOT NULL;

-- 'depth' (intro/intermediate/advanced) doesn't map cleanly onto a fixed
-- course — allow NULL for curated templates rather than forcing a misleading
-- value. Postgres CHECK constraints already pass on NULL, so no need to touch
-- the existing depth CHECK, just drop the NOT NULL.
ALTER TABLE curriculum_templates ALTER COLUMN depth DROP NOT NULL;

-- Generic subject bucket for curated courses. Keeps `subject_id NOT NULL` on
-- both curriculum_templates and quests unchanged (and every existing page
-- that joins `subjects` for a name/color chip keeps working as-is); a
-- course's real identity (instructor, term, code) lives in course_metadata.
INSERT INTO subjects (slug, name, description, color_hex, icon_slug)
VALUES ('curated', 'Curated Courses', 'Fixed courses sourced from real lecture material.', '#F4A300', 'book')
ON CONFLICT (slug) DO NOTHING;

-- ---------- Curated source material ----------

-- One row per lecture's extracted transcript, 1:1 with a template_node.
CREATE TABLE IF NOT EXISTS curated_lecture_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_node_id  uuid NOT NULL UNIQUE REFERENCES template_nodes(id) ON DELETE CASCADE,
  week_number       int NOT NULL,
  lecture_number    int NOT NULL DEFAULT 1,      -- for weeks with multiple lectures
  original_pdf_path text,                        -- object storage key (R2), for provenance / "view original"
  raw_text          text NOT NULL,                -- cleaned, extracted transcript — what the tutor grounds on
  token_count       int NOT NULL DEFAULT 0,
  checksum          text NOT NULL,                -- sha256 of the source PDF; drives re-ingestion / versioning
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz,                   -- null = not yet human-approved; template stays 'draft' until set
  reviewed_by       uuid REFERENCES app.users(id)
);

CREATE INDEX IF NOT EXISTS curated_lecture_sources_node_idx
  ON curated_lecture_sources(template_node_id);

-- Optional per-lecture assignment. Not auto-graded in v1 — see
-- curated_assignment_completions for the self-reported "reviewed it" signal.
CREATE TABLE IF NOT EXISTS curated_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_node_id  uuid NOT NULL REFERENCES template_nodes(id) ON DELETE CASCADE,
  title             text NOT NULL,
  instructions      text NOT NULL,                -- extracted from the assignment PDF
  original_pdf_path text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS curated_assignments_node_idx
  ON curated_assignments(template_node_id);

-- Self-reported completion, distinct from node_progress (which continues to
-- mean "understood the lecture material", not "did the homework").
CREATE TABLE IF NOT EXISTS curated_assignment_completions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES curated_assignments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  reviewed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, user_id)
);

CREATE INDEX IF NOT EXISTS curated_assignment_completions_user_idx
  ON curated_assignment_completions(user_id);

-- Chunk + embed only kicks in for lectures too long to inject in full, or
-- cross-week retrieval — deferred in the app until a real course needs it,
-- but modeled now so that slice doesn't need a migration later. Dimension
-- is NOT the 1536 (ada-002 / text-embedding-3-small) size assumed by
-- user_memory_chunks — pick the real embedding model before using this table
-- and size the column to match (1024 here is a placeholder for a
-- Voyage-class model; adjust before first use).
CREATE TABLE IF NOT EXISTS curated_lecture_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   uuid NOT NULL REFERENCES curated_lecture_sources(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content     text NOT NULL,
  embedding   vector(1024),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS curated_lecture_chunks_source_idx
  ON curated_lecture_chunks(source_id);

CREATE INDEX IF NOT EXISTS curated_lecture_chunks_embedding_idx
  ON curated_lecture_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
