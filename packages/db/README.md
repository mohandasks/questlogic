# @questlogic/db

Postgres migrations for QuestLogic. The schema is the canonical reference in `QuestLogic_DB_Schema.md` at the repo root — this folder applies it.

## Run

```bash
# from repo root
pnpm migrate
```

Or manually:

```bash
psql "$DATABASE_URL" -f packages/db/migrations/0001_init.sql
psql "$DATABASE_URL" -f packages/db/migrations/0002_seed.sql
```

## Migrations

| # | File | Purpose |
| - | --- | --- |
| 0001 | `0001_init.sql` | Full v1 schema: identity, curriculum, quests, sessions, messages, XP ledger, budgets, telemetry |
| 0002 | `0002_seed.sql` | Seed the three launch subjects (history, economics, philosophy) |

Row-level security policies are stubbed only — the v1 implementation uses the service role from the backend. Tighten before any direct-from-browser writes.
