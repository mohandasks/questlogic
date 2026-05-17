-- =====================================================================
-- QuestLogic v1 schema
-- Source of truth: QuestLogic_DB_Schema.md (repo root)
-- Idempotent: safe to re-run against an empty database; not a migration tool.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS app;

-- Supabase's PostgREST runs as the `authenticator` role, switching to anon /
-- authenticated / service_role per request. Custom schemas don't get USAGE by
-- default, so we grant it explicitly. Without this, every supabase-js call
-- against `app.*` returns "permission denied for schema app".
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA app TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ---------- updated_at trigger helper ----------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE user_tier AS ENUM ('free', 'pro', 'institutional');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE template_status AS ENUM ('draft', 'active', 'deprecated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE edge_type AS ENUM ('prereq', 'optional', 'related');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE quest_status AS ENUM ('active', 'paused', 'completed', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE node_status AS ENUM ('locked','available','in_progress','mastered','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_role AS ENUM ('user','assistant','system','tool');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE attempt_status AS ENUM ('in_progress','submitted','graded','disputed','resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE xp_source AS ENUM (
    'message_quality','node_started','node_mastered','assessment_passed',
    'streak_bonus','achievement','manual_adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE guild_visibility AS ENUM ('public','invite_only','private');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Identity ----------
-- app.users mirrors a Supabase Auth user. We keep a separate row so we can
-- attach product-only columns (tier, locale, deletion lifecycle) without
-- touching the auth schema.
CREATE TABLE IF NOT EXISTS app.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email           citext UNIQUE NOT NULL,
  display_name    text,
  locale          text NOT NULL DEFAULT 'en-US',
  timezone        text NOT NULL DEFAULT 'UTC',
  tier            user_tier NOT NULL DEFAULT 'free',
  tier_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS users_tier_idx ON app.users(tier) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS users_updated_at ON app.users;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id            uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  total_xp           bigint NOT NULL DEFAULT 0,
  current_level      int    NOT NULL DEFAULT 1,
  current_streak     int    NOT NULL DEFAULT 0,
  longest_streak     int    NOT NULL DEFAULT 0,
  last_active_at     timestamptz,
  preferred_subjects text[] NOT NULL DEFAULT ARRAY[]::text[],
  skill_state        jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_profiles_last_active_idx ON student_profiles(last_active_at DESC);
DROP TRIGGER IF EXISTS student_profiles_updated_at ON student_profiles;
CREATE TRIGGER student_profiles_updated_at BEFORE UPDATE ON student_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Subjects & curriculum ----------
CREATE TABLE IF NOT EXISTS subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  color_hex   text,
  icon_slug   text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS curriculum_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      uuid NOT NULL REFERENCES subjects(id),
  topic           text NOT NULL,
  depth           text NOT NULL CHECK (depth IN ('intro','intermediate','advanced')),
  content_hash    text NOT NULL,
  version         int  NOT NULL DEFAULT 1,
  status          template_status NOT NULL DEFAULT 'active',
  generator_model text NOT NULL,
  generated_by    uuid REFERENCES app.users(id),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_hash, version)
);
CREATE INDEX IF NOT EXISTS curriculum_templates_lookup_idx
  ON curriculum_templates (subject_id, topic, depth, status);

CREATE TABLE IF NOT EXISTS template_nodes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       uuid NOT NULL REFERENCES curriculum_templates(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  title             text NOT NULL,
  summary           text NOT NULL,
  content           jsonb NOT NULL DEFAULT '{}'::jsonb,
  position_x        float4,
  position_y        float4,
  order_hint        int  NOT NULL DEFAULT 0,
  depth_level       int  NOT NULL DEFAULT 0,
  estimated_minutes int,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, slug)
);
CREATE INDEX IF NOT EXISTS template_nodes_template_idx ON template_nodes(template_id);

CREATE TABLE IF NOT EXISTS template_edges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES curriculum_templates(id) ON DELETE CASCADE,
  from_node_id  uuid NOT NULL REFERENCES template_nodes(id) ON DELETE CASCADE,
  to_node_id    uuid NOT NULL REFERENCES template_nodes(id) ON DELETE CASCADE,
  edge_kind     edge_type NOT NULL DEFAULT 'prereq',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  UNIQUE (template_id, from_node_id, to_node_id)
);
CREATE INDEX IF NOT EXISTS template_edges_to_idx ON template_edges(to_node_id);

CREATE TABLE IF NOT EXISTS template_assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      uuid NOT NULL REFERENCES curriculum_templates(id) ON DELETE CASCADE,
  node_id          uuid NOT NULL REFERENCES template_nodes(id) ON DELETE CASCADE,
  question         text NOT NULL,
  question_type    text NOT NULL CHECK (question_type IN ('short_answer','essay','dialogue')),
  rubric           jsonb NOT NULL,
  difficulty       int  NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  reference_answer text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS template_assessments_node_idx ON template_assessments(node_id);

-- ---------- Quests & progress ----------
CREATE TABLE IF NOT EXISTS quests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  subject_id      uuid NOT NULL REFERENCES subjects(id),
  template_id     uuid NOT NULL REFERENCES curriculum_templates(id),
  title           text NOT NULL,
  status          quest_status NOT NULL DEFAULT 'active',
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  last_active_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS quests_user_active_idx
  ON quests(user_id, last_active_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS node_progress (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id          uuid NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  template_node_id  uuid NOT NULL REFERENCES template_nodes(id),
  status            node_status NOT NULL DEFAULT 'locked',
  attempts          int NOT NULL DEFAULT 0,
  last_score        numeric(4,3),
  best_score        numeric(4,3),
  started_at        timestamptz,
  mastered_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quest_id, template_node_id)
);
CREATE INDEX IF NOT EXISTS node_progress_user_status_idx ON node_progress(user_id, status);
DROP TRIGGER IF EXISTS node_progress_updated_at ON node_progress;
CREATE TRIGGER node_progress_updated_at BEFORE UPDATE ON node_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Sessions & messages ----------
CREATE TABLE IF NOT EXISTS sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  quest_id           uuid REFERENCES quests(id) ON DELETE SET NULL,
  current_node_id    uuid REFERENCES template_nodes(id),
  started_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  summary            text,
  summary_model      text,
  summary_updated_at timestamptz,
  message_count      int NOT NULL DEFAULT 0,
  tokens_used        bigint NOT NULL DEFAULT 0,
  deleted_at         timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_recent_idx ON sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_quest_idx ON sessions(quest_id);

CREATE TABLE IF NOT EXISTS messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role              message_role NOT NULL,
  content           text NOT NULL,
  tokens_in         int,
  tokens_out        int,
  model             text,
  pipeline          text,
  langfuse_trace_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX IF NOT EXISTS messages_session_order_idx ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS user_memory_chunks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  quest_id          uuid REFERENCES quests(id) ON DELETE CASCADE,
  source_session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  chunk_type        text NOT NULL CHECK (chunk_type IN ('summary','insight','struggle','preference')),
  content           text NOT NULL,
  embedding         vector(1536),
  embedding_model   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_memory_chunks_user_idx ON user_memory_chunks(user_id);
CREATE INDEX IF NOT EXISTS user_memory_chunks_embedding_idx
  ON user_memory_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ---------- Assessments ----------
CREATE TABLE IF NOT EXISTS assessment_attempts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  quest_id               uuid NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  template_assessment_id uuid NOT NULL REFERENCES template_assessments(id),
  status                 attempt_status NOT NULL DEFAULT 'in_progress',
  student_answer         text,
  final_score            numeric(4,3),
  feedback               text,
  started_at             timestamptz NOT NULL DEFAULT now(),
  submitted_at           timestamptz,
  graded_at              timestamptz
);
CREATE INDEX IF NOT EXISTS assessment_attempts_user_idx ON assessment_attempts(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS assessment_attempts_quest_idx ON assessment_attempts(quest_id);

CREATE TABLE IF NOT EXISTS grade_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id        uuid NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  grader_role       text NOT NULL CHECK (grader_role IN ('primary','secondary','judge','human')),
  grader_model      text,
  score             numeric(4,3) NOT NULL,
  rationale         text,
  langfuse_trace_id text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grade_runs_attempt_idx ON grade_runs(attempt_id);

CREATE TABLE IF NOT EXISTS rubric_criterion_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_run_id  uuid NOT NULL REFERENCES grade_runs(id) ON DELETE CASCADE,
  criterion_key text NOT NULL,
  weight        numeric(4,3) NOT NULL,
  score         numeric(4,3) NOT NULL,
  evidence      text
);
CREATE INDEX IF NOT EXISTS rubric_criterion_grade_idx ON rubric_criterion_scores(grade_run_id);

-- ---------- Gamification ----------
CREATE TABLE IF NOT EXISTS xp_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES app.users(id) ON DELETE SET NULL,
  amount          int  NOT NULL,
  source_type     xp_source NOT NULL,
  source_id       uuid,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS xp_events_user_time_idx ON xp_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS xp_events_source_idx ON xp_events(source_type, source_id);

CREATE TABLE IF NOT EXISTS achievements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text NOT NULL,
  icon_slug   text,
  category    text NOT NULL,
  criteria    jsonb NOT NULL,
  xp_reward   int NOT NULL DEFAULT 0,
  is_secret   boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES achievements(id),
  earned_at      timestamptz NOT NULL DEFAULT now(),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS user_achievements_user_idx ON user_achievements(user_id, earned_at DESC);

-- ---------- Social ----------
CREATE TABLE IF NOT EXISTS guilds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text UNIQUE NOT NULL,
  name         text NOT NULL,
  description  text,
  visibility   guild_visibility NOT NULL DEFAULT 'public',
  member_count int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guild_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id  uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('member','officer','owner')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS guild_members_user_idx ON guild_members(user_id);

CREATE TABLE IF NOT EXISTS leaderboard_periods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_type   text NOT NULL CHECK (period_type IN ('weekly','monthly','all_time')),
  scope         text NOT NULL CHECK (scope IN ('global','guild','subject')),
  scope_ref_id  uuid,
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,
  finalized_at  timestamptz,
  UNIQUE (period_type, scope, scope_ref_id, period_start)
);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id  uuid NOT NULL REFERENCES leaderboard_periods(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES app.users(id) ON DELETE SET NULL,
  rank       int  NOT NULL,
  xp_earned  bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leaderboard_snapshots_period_rank_idx
  ON leaderboard_snapshots(period_id, rank);

-- ---------- Metering & telemetry ----------
CREATE TABLE IF NOT EXISTS llm_calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES app.users(id) ON DELETE SET NULL,
  session_id        uuid REFERENCES sessions(id) ON DELETE SET NULL,
  pipeline          text NOT NULL,
  model             text NOT NULL,
  provider          text NOT NULL,
  tokens_in         int NOT NULL,
  tokens_out        int NOT NULL,
  cost_micros       bigint NOT NULL,
  latency_ms        int,
  langfuse_trace_id text,
  succeeded         boolean NOT NULL DEFAULT true,
  error_class       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_calls_user_time_idx ON llm_calls(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_calls_pipeline_time_idx ON llm_calls(pipeline, created_at DESC);

CREATE TABLE IF NOT EXISTS user_token_budgets (
  user_id         uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  period_start    date NOT NULL,
  tokens_used     bigint NOT NULL DEFAULT 0,
  tokens_limit    bigint NOT NULL,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_start)
);
