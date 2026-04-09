# Progress

## Last Session

- **Date:** 2026-04-09 (Phase 0a scaffolding)
- **Branch:** `main` (clean, single initial commit)
- **Summary:**
  - **Phase 0a — Project scaffolding + docs** complete. Everything in this session is infrastructure, NO source code yet.
  - Repo initialized with `git init`, default branch `main`
  - Baseline config: `.gitignore`, `.gitattributes`, `.editorconfig`, `.prettierrc`, `.prettierignore`, `.env.example`
  - Top-level docs: `README.md`, `CLAUDE.md`, this `PROGRESS.md`
  - `docs/` scaffolded: `plan.md` (full implementation blueprint, copied from the Claude Code plan file), `architecture.md`, `data-model.md`, `simplefin-notes.md`, `ai-tools.md`, `development.md`, `deployment.md`, plus `decisions/0001-fresh-typescript-build.md` (first ADR explaining why we built from scratch rather than forking Maybe Finance)
  - `.claude/` workflow tooling installed — emulates the user's `context-engine` parallel-Claude pattern:
    - `.claude/settings.json` — project-level permissions allowlist
    - `.claude/skills/session-start/SKILL.md` — solo session init
    - `.claude/skills/session-end/SKILL.md` — updates this file
    - `.claude/skills/start/SKILL.md` — coordinator: generates `PROMPT_INSTANCE_A.md` + `PROMPT_INSTANCE_B.md`
    - `.claude/skills/start-worker/SKILL.md` — worker: executes a prompt in a git worktree
    - `.claude/skills/review-workers/SKILL.md` — coordinator: reviews worker PRs before merge
  - Initial commit: `chore: scaffold project + planning docs`
- **No code, no `package.json`, no `node_modules`, no Docker stack yet.** That all lands in Phase 0b via `/start` + two parallel Claude instances.

## Next Up — Phase 0b — Code scaffolding

Run `/start` to generate worker prompts for the two parallel Claude instances. The coordinator will propose something like:

### Instance A — `packages/db` + `packages/core` scaffold

- `pnpm init`, `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`
- `packages/db/` — Drizzle setup, full schema in `packages/db/schema/` (family, user, membership, account + polymorphic detail tables, entry, entry_line, category, rule, budget, recurring, goal, connection, sync_run), first migration, seed script for dev data
- `packages/core/` — empty module scaffolds with Zod schema stubs + Vitest test harness (no implementation yet)
- **Owns:** `packages/db/**`, `packages/core/**`, root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`

### Instance B — `apps/web` + `infra/` + CI

- `apps/web/` — Next.js 15 App Router scaffold, TypeScript strict, ESLint, Prettier, Tailwind CSS 4, shadcn/ui initialized, Better Auth wired with `organization` plugin, basic layout shell (landing → auth → authenticated app shell with nav)
- `infra/docker-compose.dev.yml` + `infra/docker-compose.prod.yml` (`app`, `postgres`, `caddy`) + `infra/Caddyfile` + `scripts/dev-init.sh`
- `.github/workflows/ci.yml` — lint, typecheck, test, build on push
- **Owns:** `apps/web/**`, `infra/**`, `scripts/**`, `.github/workflows/**`

**Disjoint ownership** — zero file overlap between A and B. Neither touches `packages/simplefin`, `packages/ai`, or `packages/jobs` — those scaffolds come in Phase 1 when there's real code to put in them.

## Blockers / Open Decisions

- **Domain name** — needed before Phase 1 deploys to the VPS. Decide whether to use a subdomain of an existing domain or register a new one (~$12/yr)
- **VPS provider** — plan assumes Hetzner CX22. Confirm during Phase 0b / before Phase 1 deploy
- **SimpleFIN Bridge account** — user signs up at `https://beta-bridge.simplefin.org/simplefin/create` (~$15/yr) when we're ready to ingest real data in Phase 1
- **Off-site backup target** — Backblaze B2 assumed; decide during Phase 0b deploy
- **Email provider** — Resend vs. in-app-only for insights. Decide during Phase 3

None of these block Phase 0b. We can start the next session with `/start` immediately.

## Environment State

- **Node:** (not yet installed per-project — `apps/web` scaffold in Phase 0b will set this)
- **pnpm:** not yet installed via corepack in this project
- **Docker:** not yet set up — Phase 0b lands `docker-compose.dev.yml`
- **Postgres:** not yet running — Phase 0b spins it up via Docker
- **Tests:** 0 / 0 (no code yet)
- **Lint / types:** n/a

## Notes for Next Session's Coordinator

- **Read `docs/plan.md` first.** It is the single source of truth for what's supposed to happen across all phases. Do not re-derive the architecture; it's been designed.
- **Read `CLAUDE.md`** for session protocol, key constraints (amounts are NUMERIC(19,4), PII stripped at AI tool boundary, every entry's lines sum to zero, row-level security on every table), and the "what NOT to do" list.
- **Read `docs/simplefin-notes.md`** before any code goes into `packages/simplefin`. The SimpleFIN quirks are load-bearing and trivially forgotten.
- **Use `/start`** to dispatch the two workers — not `/session-start`. `/start` is the parallel-workflow variant.
- **The two Phase 0b workers should have completely disjoint scope** (see "Next Up" above). Instance A never touches `apps/web`; Instance B never touches `packages/db`.
- **Before workers start, verify `pnpm` is available on the host** (`corepack enable && corepack prepare pnpm@latest --activate`). Instance A will run `pnpm init` and expects pnpm to exist.
