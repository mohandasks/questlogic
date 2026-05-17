# Deploying QuestLogic (v0)

End-to-end deploy for the friends-and-family stage:

- **Vercel** for the Next.js app (free tier)
- **Fly.io** for the FastAPI AI service (free/cheap tier)
- **Supabase** stays where it is

Total time: ~30 minutes if you have accounts ready. ~60 minutes if you're signing up for everything fresh.

---

## 0. Prerequisites

- A GitHub account, and the project pushed to a repo there.
- A Vercel account, ideally linked to GitHub.
- A Fly.io account. Install the CLI: `brew install flyctl`, then `fly auth signup` or `fly auth login`.
- The `.env` file from local dev (you'll copy values out of it into each platform's settings).
- Anthropic API key with a real payment method (you're about to share it with friends — set a usage cap in Anthropic console first: **Settings → Limits**).

---

## 1. Deploy the AI service to Fly.io

From the repo root:

```bash
cd apps/ai
fly launch --no-deploy
```

`fly launch` will ask a few questions:

| Prompt | Answer |
| --- | --- |
| App name | Pick something globally unique like `questlogic-ai-<yourname>` |
| Region | Nearest to you — `iad` (US-East), `lhr` (London), `nrt` (Tokyo), etc. |
| Postgres? | **No** (we use Supabase) |
| Redis? | **No** |
| Deploy now? | **No** — we need to set secrets first |
| Tweak settings? | **No** — `fly.toml` is already configured |

If `fly launch` asks to overwrite the existing `fly.toml`, say **no**. The committed one is tuned (auto-stop on idle, 512 MB RAM, single shared CPU). It may, however, change the `app = ...` line to match the name you picked — that's fine.

Set the runtime secrets:

```bash
fly secrets set \
  ANTHROPIC_API_KEY="sk-ant-..." \
  AI_SERVICE_SHARED_SECRET="$(openssl rand -hex 32)" \
  DATABASE_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
```

The `AI_SERVICE_SHARED_SECRET` generated here is a fresh production-only secret — you'll plug the same value into Vercel in the next step. **Don't reuse your local dev secret in production.**

Deploy:

```bash
fly deploy
```

After deploy succeeds, note the URL — it'll look like `https://questlogic-ai-<yourname>.fly.dev`. Verify:

```bash
curl https://questlogic-ai-<yourname>.fly.dev/healthz
# {"status":"ok"}
```

---

## 2. Deploy the web app to Vercel

Vercel works best with monorepos when configured via its dashboard.

**Push the repo to GitHub first** if you haven't:

```bash
git init
git add .
git commit -m "QuestLogic v0"
gh repo create questlogic --private --source=. --push
# or use the GitHub web UI
```

In the Vercel dashboard:

1. **Import Project** → pick your GitHub repo.
2. **Configure Project**:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `apps/web` ← important
   - **Build Command**: leave as default (`next build`)
   - **Output Directory**: leave as default
   - **Install Command**: override to `cd ../.. && pnpm install --frozen-lockfile`
   - **Node.js version**: 20.x or 22.x

3. **Environment Variables** — add these (copy values from your local `.env`, except where noted):

   | Name | Value | Notes |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://lzyjcpzlgiirtinztzmw.supabase.co` | Public |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Public |
   | `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase API settings) | **Sensitive** |
   | `AI_SERVICE_URL` | `https://questlogic-ai-<yourname>.fly.dev` | From step 1 |
   | `AI_SERVICE_SHARED_SECRET` | (same value you set on Fly) | **Sensitive** |
   | `FREE_TIER_TOKENS_PER_MONTH` | `100000` | |

   Skip `DATABASE_URL` on Vercel — Next.js doesn't talk to Postgres directly in v0; everything goes through `supabase-js`. The migration script is local-only.

4. Click **Deploy**. First build takes ~3 minutes.

After deploy, note the URL — `https://questlogic-<random>.vercel.app`. You can rename the project later in **Settings → General**.

---

## 3. Tell Supabase about your production URL

Two settings to update in the Supabase dashboard:

### 3a. Auth redirect URLs

**Authentication → URL Configuration → Redirect URLs**: add your Vercel URL.

```
https://questlogic-<random>.vercel.app
https://questlogic-<random>.vercel.app/**
```

The `/**` glob covers `/auth/callback` and any future OAuth flows. Without this, email confirmation links will reject the redirect.

### 3b. Site URL

**Authentication → URL Configuration → Site URL**: set to your Vercel URL.

This is the default destination Supabase uses for password-reset and email-verification emails.

---

## 3c. Heads up: dev DB == prod DB

You've been developing against your live Supabase project, which means your dev database **is** your prod database. Your local sign-ups, test quests, and chat history will be visible to friends if they end up on the same project. For a friends-and-family deploy this is usually fine — but if you want a clean slate before sharing, run these in the Supabase SQL editor:

```sql
delete from messages;
delete from sessions;
delete from node_progress;
delete from quests;
delete from template_edges;
delete from template_nodes;
delete from template_assessments;
delete from curriculum_templates;
delete from xp_events;
delete from user_token_budgets;
delete from student_profiles;
delete from app.users;
-- Then delete your own auth user from Authentication → Users in the dashboard.
```

Long-term, separate dev and prod projects. Not needed yet.

---

## 4. Smoke test

Visit your Vercel URL in an incognito window:

1. **Sign up** with a real email. If email confirmation is on, check inbox, click link, get redirected.
2. **Start a quest** — pick Philosophy, topic "Plato's cave", depth intro. Expect ~15s wait.
3. **Open a node, chat with the tutor.** Watch for streaming.
4. **Open Fly logs** in another terminal:

   ```bash
   fly logs --app questlogic-ai-<yourname>
   ```

   You should see request logs as you chat. If you see `401 Unauthorized`, the shared secret is mismatched between Vercel and Fly.

5. **Check Supabase** — `llm_calls`, `messages`, and `quests` tables should have new rows.

---

## 5. Share

Send friends the Vercel URL. They sign up themselves; you don't need to add them anywhere.

Each friend gets their own `app.users` row, their own 100K token budget, and their own quest history. The architecture is multi-tenant by default — what you built locally works for any number of users without changes.

---

## 6. Watch your bill

The two cost sources, in order of risk:

**Anthropic.** Each tutoring session burns tokens. Set a hard monthly cap in **Anthropic Console → Settings → Limits → Spend limits**. Start it at $20/month — you'll get an email well before you hit it.

**Fly.io.** With `auto_stop_machines = "stop"` in `fly.toml`, the AI service shuts down when idle and only runs when invoked. Free tier covers a few thousand hours/month, which is more than you'll use. The first request after idle has a ~2 second cold start — friends will notice on the first message.

**Vercel.** Free tier is generous; you'd have to be sending hundreds of GB/month to exceed it. Not a real risk at this scale.

**Supabase.** Free tier is fine for under ~50K MAU. Watch the Postgres storage if conversations get long, but you're nowhere near the cap.

---

## 7. Iterating after deploy

For schema changes:

```bash
# Apply against production:
DATABASE_URL="postgres://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres" \
  pnpm migrate
```

For code changes: push to `main` on GitHub. Vercel auto-deploys the web app. For the AI service, run `cd apps/ai && fly deploy` from the repo root.

If you want a real CI/CD pipeline (deploy on push for both), add `.github/workflows/deploy.yml` — happy to scaffold one when you're ready.

---

## 8. Known limits at this stage

You haven't built any of these yet; flag for friends so expectations are right:

- **No loading state during quest generation.** Form sits idle for 10–20 seconds. Some friends will think it's frozen.
- **XP and levels don't update.** The dashboard stats are placeholders.
- **No way to delete a quest** from the UI (rows can be hidden by setting `deleted_at` directly in SQL).
- **No password reset UI.** It works via Supabase email flow but the UI doesn't have a "forgot password" link yet.
- **Skill tree is a list**, not a DAG visualization.
- **Cold start on AI service** (~2s) after the machine has been idle.

If any of these become real friction during the friends test, they jump the queue for the next slice.
