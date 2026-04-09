# Development Setup

> **Status:** Stub — fills in during Phase 0b when `package.json`, `pnpm-workspace.yaml`, and `docker-compose.dev.yml` land. This file describes the intended dev loop; commands below are the target state, not yet runnable.

## Prerequisites

- **Node.js 22+** (LTS) — via [nvm](https://github.com/nvm-sh/nvm) or [volta](https://volta.sh/) or a direct install
- **pnpm 9+** — easiest via corepack: `corepack enable && corepack prepare pnpm@latest --activate`
- **Docker Desktop** (or Docker Engine) — for the Postgres dev container
- **Git** — and the GitHub CLI (`gh`) if you want to open PRs from the command line

## First-time setup (Phase 0b+)

```bash
git clone <repo>
cd budget-tracker

# Environment
cp .env.example .env.local
# Edit .env.local and fill in at minimum:
#   - BETTER_AUTH_SECRET (openssl rand -base64 32)
#   - ENCRYPTION_MASTER_KEY (openssl rand -base64 32)
#   - ANTHROPIC_API_KEY (from console.anthropic.com; needed for Phase 3+)

# Install dependencies
pnpm install

# Start infra (Postgres on port 5432)
docker compose -f infra/docker-compose.dev.yml up -d

# Run migrations + seed dev data
pnpm db:migrate
pnpm db:seed

# Start the dev server
pnpm dev
```

Open <http://localhost:3000> — you should see the landing page. Sign up with any email (no real email sent in dev).

## Common commands

_All of these are defined in the root `package.json` from Phase 0b onward:_

| Command | What it does |
|---|---|
| `pnpm dev` | Start Next.js in dev mode with hot reload |
| `pnpm build` | Production build |
| `pnpm start` | Run the production build locally |
| `pnpm lint` | Run ESLint across the monorepo |
| `pnpm lint:fix` | Auto-fix lint issues |
| `pnpm typecheck` | Run `tsc --noEmit` across all packages |
| `pnpm format` | Prettier format (check only) |
| `pnpm format:fix` | Prettier write |
| `pnpm test` | Unit tests (Vitest) across all packages |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:integration` | Integration tests (Vitest + disposable Postgres) |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Populate dev data |
| `pnpm db:studio` | Open Drizzle Studio for a visual DB explorer |
| `pnpm db:reset` | Drop and recreate the dev DB (destructive) |
| `bash scripts/dev-init.sh` | Health check: Docker up, DB reachable, migrations current, unit tests green |

## Running only part of the monorepo

```bash
# Just the web app
pnpm --filter @budget/web dev

# Just the core package tests
pnpm --filter @budget/core test

# Just the db package migrations
pnpm --filter @budget/db db:migrate
```

## Workspace layout

See `CLAUDE.md` under "Repository Structure" for the full tree. In short:

- `apps/web/` — the Next.js app; run with `pnpm dev`
- `packages/db/` — Drizzle schema, migrations, client factory
- `packages/core/` — framework-agnostic business logic (no Next.js, no DB client import)
- `packages/simplefin/` — SimpleFIN Bridge client
- `packages/ai/` — Anthropic SDK wrapper + typed financial query tools
- `packages/jobs/` — pg-boss workers (separate Node process from the web server)

## Adding a new feature

1. **Read `docs/plan.md`** to see which phase the feature belongs to and whether it was already designed
2. **If the feature needs a schema change**: update `packages/db/schema/*.ts`, run `pnpm db:generate`, review the generated migration, run `pnpm db:migrate`
3. **If it's business logic**: add pure functions to the right `packages/core/<domain>/` module with unit tests in the same directory (`*.test.ts`)
4. **If it's UI**: add server actions and components in `apps/web/app/(app)/<route>/` using shadcn/ui primitives
5. **Run the full check before committing**: `pnpm lint && pnpm typecheck && pnpm test`

## Testing philosophy

- **`packages/core`** must have near-total unit test coverage. It's pure functions — there's no excuse.
- **`packages/db`** tests go in `packages/db/*.test.ts` and use a disposable Postgres (Testcontainers or a container per test run)
- **`packages/simplefin`** tests use recorded JSON fixtures from real SimpleFIN responses (anonymized) to exercise the parser + dedup + pending-posted transitions + rate limit handling
- **`packages/ai`** tests include a **red-team suite** for the PII stripper — a list of known PII patterns that must be detected and removed
- **`apps/web`** mostly relies on Playwright E2E; we keep unit tests for components light unless they have non-trivial logic

## Git / branching

- **Default branch:** `main`
- **Feature branches:** `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`, etc.
- **Worktree branches:** `feature/instance-<A|B>-<round>-<summary>` for parallel-Claude work
- **Commits:** Conventional Commits format (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`)
- **PRs:** Required for any merge to `main`, even solo work. The GitHub CLI makes this one-line: `gh pr create --fill`

## Debugging tips

- **Drizzle generated SQL logs:** set `DATABASE_LOG_QUERIES=1` in `.env.local`
- **pg-boss job failures:** check the `pgboss.job` table or run `pnpm jobs:status`
- **SimpleFIN sync issues:** check the `sync_run` table for the gzipped raw response from the last 7 days
- **AI tool calls:** check `chat_message.tool_calls_json` to see exactly what the model asked for and what it got back
- **RLS surprises:** if a query unexpectedly returns empty, verify `current_setting('app.current_family_id')` is set for that connection
