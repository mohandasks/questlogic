# questlogic-ai

FastAPI service that owns the two LLM pipelines:

- `POST /quests/generate` — curriculum generation, returns a skill-tree JSON.
- `POST /chat/stream` — streamed tutor response (plain text chunks).

The service is shared-secret authenticated and intended to be reached only from the Next.js backend, not from the browser.

## Run locally

```bash
cd apps/ai
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn questlogic_ai.main:app --reload --port 8000
```

Or from the repo root:

```bash
pnpm dev:ai
```

Env vars (read from `.env` at the repo root via `python-dotenv`):

| Var | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Provider key |
| `AI_SERVICE_SHARED_SECRET` | yes | Bearer token the Next.js service uses to call us |
| `ANTHROPIC_MODEL_TUTOR` | no | Defaults to `claude-sonnet-4-6` |
| `ANTHROPIC_MODEL_CURRICULUM` | no | Defaults to `claude-sonnet-4-6` |
| `ANTHROPIC_MODEL_CHEAP` | no | Defaults to `claude-haiku-4-5-20251001` |
| `DATABASE_URL` | no | If set, writes `llm_calls` rows. If absent, telemetry is skipped. |

See `src/questlogic_ai/llm/client.py` for how to add a second provider.
