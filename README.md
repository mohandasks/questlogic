# QuestLogic AI

Gamified, AI-native learning platform. v1 launches with three subjects (history, economics, philosophy), adults-only, free tier metered at 100K tokens/month.

Design docs:
- [Technical architecture](./QuestLogic_Architecture.md)
- [Database schema](./QuestLogic_DB_Schema.md)

## Repo layout

```
.
├── apps/
│   ├── web/          # Next.js frontend + API routes (TypeScript)
│   └── ai/           # FastAPI AI orchestration service (Python)
├── packages/
│   ├── db/           # SQL migrations
│   └── shared/       # TypeScript types shared by Next.js (and any future Node service)
└── README.md
```

## First-time setup

You need:

- Node 20+ and pnpm 9+
- Python 3.12+
- A Supabase project (free tier is fine) — handles both database and auth
- An Anthropic API key

### 1. Clone and install

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env` with the values from your Supabase and Anthropic dashboards. The minimum set you must provide:

- `DATABASE_URL` — Supabase Session pooler URI (port 5432) for migrations
- `NEXT_PUBLIC_SUPABASE_URL` — Project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — public-by-design anon key (ships to the browser, respects RLS)
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, bypasses RLS (used for cross-table writes during quest creation)
- `ANTHROPIC_API_KEY`
- `AI_SERVICE_SHARED_SECRET` — generate any long random string

In your Supabase dashboard, decide whether to keep **email confirmation** on (Authentication → Providers → Email). With it on, users get a confirmation link and `/auth/callback` finishes the sign-in. With it off, sign-up logs them in immediately.

### 3. Link .env into the Next.js app

Next.js only reads `.env` files from its own project directory. We keep one `.env` at the repo root and symlink it into `apps/web/` so both the Python service (loads from repo root) and Next.js (loads from `apps/web/`) see the same values:

```bash
ln -sf ../../.env apps/web/.env.local
```

This is a one-time setup; the symlink survives across pulls.

### 4. Run database migrations

```bash
pnpm migrate
```

This applies `packages/db/migrations/0001_init.sql` (the v1 schema) and `0002_seed.sql` (subjects + starter achievements).

### 5. Set up the AI service

```bash
cd apps/ai
python -m venv .venv
source .venv/bin/activate
pip install -e .
cd ../..
```

### 6. Run both services

In one terminal:

```bash
pnpm dev:web    # Next.js on http://localhost:3000
```

In another:

```bash
pnpm dev:ai     # FastAPI on http://localhost:8000
```

Visit http://localhost:3000, sign up, then start your first quest.

## What's in v0

This is the vertical-slice MVP — proves the full stack works end-to-end:

- Supabase Auth (email + password), with custom sign-in/sign-up pages. `app.users` mirrors the auth user on first request.
- Dashboard with quests list and XP/level/streak stats (stats are placeholders until the gamification slice lands)
- Quest creation flow: pick subject + topic → generate skill tree → write template, nodes, edges, and per-user progress rows
- Skill-tree view (list-based for v0; React Flow DAG view is a follow-up)
- Tutor chat per node, streaming responses, persisted to `messages`
- Free-tier token budget enforcement (rough; canonical count lives in `llm_calls` written by the AI service)
- LLM call telemetry to `llm_calls` (if `DATABASE_URL` is reachable from the AI service)

## What's not in v0 — by design

Cut from this slice; revisit in subsequent vertical slices:

- Assessments / boss fights
- Achievements and XP awarding (tables exist; nothing writes to them yet)
- Leaderboards and guilds
- Background summarization and `user_memory_chunks` retrieval
- Inngest jobs
- Langfuse wiring (env var slot reserved; not yet integrated)
- React Flow visualization of the DAG
- Multi-provider model routing (only Anthropic is wired)
- Redis-backed token meter (Postgres-only for now)
- Row-level security policies on user-owned tables

## Things you'll hit if you actually run this

- **Curriculum generation takes 10–20 seconds.** No UI feedback beyond a static message during the form submit. Add a loading state when the gamification slice lands.
- **Skill-tree layout is heuristic.** Nodes order by status and indegree, not by a proper topological pass. Fine at 6–10 nodes; degrades past 15.
- **Sessions persist forever.** No "end session" UI in v0. Each node has at most one open session per user.
- **Token accounting is approximate on the web side.** Use the AI-service-written `llm_calls` rows as the source of truth for cost analysis.

## Next slice

Per the architecture doc's build order, weeks 4–6:

1. Real curriculum-template caching by content hash (skip the LLM if a recent template exists)
2. XP ledger writes on message-sent and node-mastered
3. Inngest event pipeline replacing the inline updates in `/api/chat`
4. React Flow skill-tree visualization
