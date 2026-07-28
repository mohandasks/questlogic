-- Session sharing: lets a student publish a read-only link to a single
-- session's transcript (i.e. the chat for one sub-topic/node). Sharing is
-- opt-in and per-session — the rest of the quest stays private.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS share_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS shared_at  timestamptz;

CREATE INDEX IF NOT EXISTS sessions_share_slug_idx
  ON sessions(share_slug)
  WHERE share_slug IS NOT NULL;
