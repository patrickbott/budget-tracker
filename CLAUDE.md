# Budget Tracker

## Project Summary

A self-hosted personal finance and budget tracker. Ingests bank data via **SimpleFIN Bridge**, layers AI insights on top (chat, passive weekly insights, auto-categorization with rule induction, proactive coaching), supports **hybrid shared-household + personal** data via Better Auth's organization model, and runs on a small Hetzner VPS reachable as a **Progressive Web App** from phone and desktop. Built because YNAB, Mint, and Excel all fall short for different reasons — this one is owned end-to-end by the user.

The full implementation blueprint is in `docs/plan.md`. Read it before making architectural decisions.

## Session Protocol

Every Claude Code session on this repo follows this protocol. It exists because our context resets between sessions and we rely on durable files to stay continuous.

### At the start of a session

1. **Read `PROGRESS.md`** to understand what happened last session and what's queued up next.
2. **Verify git state** matches `PROGRESS.md`:
   ```bash
   git log --oneline -10
   git status
   git worktree list
   ```
3. If there's any drift (unexpected branches, stale worktrees, uncommitted work), flag it before continuing.
4. **For solo work**: run `/session-start` to automate the checks above.
5. **For parallel work**: run `/start` to generate `PROMPT_INSTANCE_A.md` + `PROMPT_INSTANCE_B.md` and spawn workers in git worktrees.

### At the end of a session

6. **Update `PROGRESS.md`** with what was done, commits made, what's next, blockers, and environment state.
7. Run `/session-end` to automate the update.
8. Keep it scannable — `PROGRESS.md` should be readable in 10 seconds.

### Important: `PROGRESS.md` is NOT documentation

- It is a **transient working file** that gets overwritten every session. Do not treat it like a doc.
- Do **not** reference it from `docs/**` files, and do **not** include its history in commit messages.
- Its only purpose is cross-session continuity for Claude Code conversations. Durable project facts live in `docs/**`, the plan file, and ADRs.

## Architecture Overview

The app is a monorepo built around a **Maybe-Finance-inspired polymorphic data model** with **Firefly-III-style double-entry under the hood**. Same approach documented in `docs/architecture.md` and `docs/data-model.md`.

**Three conceptual layers:**

1. **Ingestion** (`packages/simplefin`, `packages/jobs`) — SimpleFIN Bridge client, daily pull cron, transaction dedup, pending→posted transitions, transfer detection heuristics
2. **Core domain** (`packages/core`) — framework-agnostic business logic: double-entry invariant enforcement, rules engine, budget math, transfer detection, recurring detection, reporting functions. Pure TypeScript, no framework dependencies, fully unit-testable
3. **Presentation + AI** (`apps/web`, `packages/ai`) — Next.js App Router UI, server actions, Better Auth, Anthropic SDK with typed financial-query tool calling, PWA shell

**Data model summary** (full ERD in `docs/data-model.md`):

- **`family`** is the tenant root (Better Auth organization = family). Every row scopes through `family_id`.
- **`user`** joins `family` via `membership` with a role.
- **`account`** is polymorphic by `account_type` (depository / credit_card / investment / loan / property / crypto / other). Each account has `visibility` (`household` | `personal`) and optional `owner_user_id` for personal-scope accounts.
- **`entry`** is polymorphic by `entryable_type` and represents every financial event: bank transactions, transfers, manual valuations, (later) trades.
- **`entry_line`** is the Firefly-style double-entry row: each entry has ≥2 signed lines that must sum to zero. Splits, transfers, refunds, and multi-currency all collapse into this mechanism.
- **`category`**, **`rule`**, **`budget`**, **`recurring`**, **`goal`** round out the domain.
- **`connection`** stores the encrypted SimpleFIN Access URL; **`sync_run`** logs every pull (gzipped raw JSON, 7-day retention).

## Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15** (App Router) + TypeScript 5 | Server components + server actions; PWA via `@ducanh2912/next-pwa` |
| Package manager | **pnpm** | Monorepo via `pnpm-workspace.yaml` |
| Database | **Postgres 16** | JSONB for SimpleFIN `extra`, row-level security for family scoping, NUMERIC(19,4) for amounts |
| ORM | **Drizzle** | Type-safe SQL, lightweight, good migrations |
| Auth | **Better Auth** | Self-hostable; `organization` plugin = households |
| UI | **Tailwind CSS 4** + **shadcn/ui** | Plus **Recharts** (charts) and **Tanstack Table v8** (transaction grid) |
| AI | **Anthropic SDK** | Opus 4.6 (chat), Haiku 4.5 (batch). Native `tool_use` API for typed financial query tools |
| Jobs | **pg-boss** | Postgres-backed queue — no Redis dependency |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | |
| Reverse proxy | **Caddy** | Auto-TLS via Let's Encrypt |
| Deployment | **Docker Compose** on a **Hetzner VPS** | CX22 (x86) or CAX11 (ARM) |

## Key Constraints

- **SimpleFIN quirks are load-bearing.** See `docs/simplefin-notes.md`: pull-only (no webhooks), ~24-hour upstream refresh, 24 requests/day quota, 90-day history max per request, descriptions truncated to ~32 chars, amounts delivered as strings (never `parseFloat` them), transaction IDs opaque and only unique per account, account IDs unstable across re-linking, no categories, no holdings schema for investments.
- **Amounts must never be stored as float.** `NUMERIC(19,4)` in Postgres, `decimal.js` in TypeScript. A single floating-point cent of drift is unacceptable in a finance app.
- **Row-level security** enforces `family_id` scoping at the database level, not just the app layer. Every table has an RLS policy keyed on a connection-scoped session variable set by Drizzle middleware.
- **AI must not see raw PII.** Tool return shapes are PII-stripped at the boundary — no emails, no account numbers, no user names leave the tool functions. This is a hard constraint; the PII stripper has its own test suite.
- **Every `entry`'s lines must sum to zero.** Enforced by CHECK constraint + trigger. Unit tests pin this invariant on every mutation path.
- **Hard monthly AI spend cap per family** (default $10, configurable via `AI_MONTHLY_SPEND_CAP_USD`). Tracked, warned at 80%, blocked at 100%.
- **Self-hosted, not SaaS.** The end user pays SimpleFIN directly (~$15/yr) and owns their VPS. No telemetry. No external services beyond Anthropic API + SimpleFIN + (optional) Resend for email + (optional) B2 for backups.

## Current Phase

**Phase 0a — Project scaffolding** ✅ (this commit)

**Phase 0b — Code scaffolding** ⏳ next. Done via `/start` → two parallel Claude instances:
- Instance A: `packages/db` (full Drizzle schema, migrations, seed script) + `packages/core` scaffold (empty modules, test harness, Zod schemas stub)
- Instance B: `apps/web` Next.js app shell, Better Auth wiring, Tailwind+shadcn setup, basic routes, Docker Compose dev stack, CI workflows

See `docs/plan.md` for the full phase arc (Phases 1–5).

## Repository Structure

```
budget-tracker/
├── apps/web/                          # Next.js 15 App Router (Phase 0b+)
│   ├── app/(auth)/                    # login, signup, household select
│   ├── app/(app)/                     # authenticated shell
│   │   ├── dashboard/
│   │   ├── accounts/
│   │   ├── transactions/
│   │   ├── categories/
│   │   ├── budgets/
│   │   ├── rules/
│   │   ├── recurring/
│   │   ├── goals/
│   │   ├── insights/                  # weekly/monthly AI reports archive
│   │   └── chat/                      # AI chat UI
│   ├── components/ui/                 # shadcn/ui primitives
│   ├── components/domain/             # account-card, transaction-row, budget-ring, ...
│   └── lib/                           # db client, auth, formatters
├── packages/
│   ├── db/                            # Drizzle schema + migrations
│   │   └── schema/                    # one file per domain: family, account, entry, ...
│   ├── core/                          # Framework-agnostic business logic
│   │   ├── entries/                   # double-entry invariant
│   │   ├── rules/                     # evaluator, ranker, inducer
│   │   ├── budgets/                   # status + forecasting math
│   │   ├── transfers/                 # detection heuristic
│   │   ├── recurring/                 # detection + missing_dates
│   │   ├── reports/                   # spending_by_category, cashflow, net_worth
│   │   └── types/                     # shared types + Zod schemas
│   ├── simplefin/                     # SimpleFIN Bridge client
│   ├── ai/                            # Anthropic + typed financial query tools + PII stripper
│   └── jobs/                          # pg-boss workers (sync, auto-cat, insights, coaching)
├── infra/
│   ├── docker-compose.dev.yml
│   ├── docker-compose.prod.yml
│   ├── Caddyfile
│   ├── vps-setup.md
│   └── backup/                        # pg_dump → age encryption → B2 upload
├── docs/
│   ├── plan.md                        # Implementation blueprint
│   ├── architecture.md
│   ├── data-model.md
│   ├── simplefin-notes.md
│   ├── ai-tools.md
│   ├── development.md
│   ├── deployment.md
│   └── decisions/                     # ADRs
├── scripts/                           # dev-init.sh, backup.sh, etc.
├── .claude/
│   ├── settings.json                  # project-level Claude Code settings
│   └── skills/                        # project-level skills
│       ├── session-start/
│       ├── session-end/
│       ├── start/
│       ├── start-worker/
│       └── review-workers/
├── .github/workflows/                 # CI: lint, typecheck, test, build
├── CLAUDE.md                          # <- you are here
├── PROGRESS.md                        # transient session state
├── README.md
├── package.json                       # (Phase 0b)
└── pnpm-workspace.yaml                # (Phase 0b)
```

The `packages/core` package is pure TypeScript with no framework dependencies. Everything in `core` is unit-testable without a browser, a database client, or a network. This matters because the double-entry invariant, rules engine, transfer detection, and budget math are exactly the places where bugs cost real trust.

## Parallel Claude workflow

The user prefers **two-worker parallel development** with a coordinator review pass before merge. This is emulated from the user's `context-engine` project. The workflow lives in `.claude/skills/` as four skills:

| Skill | When to use |
|---|---|
| `/session-start` | Solo work. Reads `PROGRESS.md`, verifies git state, runs `scripts/dev-init.sh` |
| `/start` | Parallel work. Coordinator Claude reviews state + plan, generates `PROMPT_INSTANCE_A.md` + `PROMPT_INSTANCE_B.md` with disjoint file ownership, and asks for user approval before workers are launched |
| `/start-worker A` / `/start-worker B` | Inside a **new Claude session** (one per instance). Reads the corresponding prompt file, creates `.worktrees/instance-A` (or B), switches into it, and executes the tasks |
| `/review-workers` | Back in the coordinator session after both workers have opened PRs. Reviews each PR substantively, verifies scope compliance + PR body claims, reads the actual code, and hands back per-PR verdicts (APPROVED / CHANGES_REQUESTED / BLOCKED) |
| `/session-end` | At the end of any session. Updates `PROGRESS.md` with a concise 10-second-scannable summary |

**Key conventions:**
- Worker branches live at `.worktrees/instance-A` / `.worktrees/instance-B` with their own feature branches.
- Worker prompts enforce **strict non-overlapping file ownership**. Any file in the worker's diff that's outside their ownership list is a review finding.
- The coordinator does NOT merge PRs — the user reviews the verdict and merges on GitHub.
- The coordinator does NOT fix bugs found during review. It reports; the worker pushes fixups.
- `PROMPT_INSTANCE_A.md` and `PROMPT_INSTANCE_B.md` are **gitignored** — they are regenerated per round.

## Working With This Project

- Before building a component or package, read its section in `docs/architecture.md` and `docs/data-model.md`.
- Before touching SimpleFIN code, re-read `docs/simplefin-notes.md` — the quirks are load-bearing and easy to forget.
- When making an architectural decision that affects >1 component, write an ADR in `docs/decisions/`.
- When a major decision changes, update the plan file (`docs/plan.md`) rather than leaving a stale plan.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).

## Testing Approach

_This section will expand as phases land code. For now, the testing strategy is:_

- **Unit tests** (Vitest, in `packages/core/**/*.test.ts`): framework-agnostic business logic. No database, no network, no filesystem. Must run in < 5 seconds.
- **Integration tests** (Vitest, gated by `test:integration`): exercise the real database via a disposable Postgres container. Cover the double-entry invariant, rules engine, SimpleFIN ingest path (against recorded fixtures), and the AI tool functions.
- **E2E tests** (Playwright, in `apps/web/e2e/`): signup → household create → fake SimpleFIN → see transactions → create rule → create budget → run chat query. Use a fixture-replaying fake SimpleFIN server.
- **Manual verification checklist** (in `docs/plan.md` — "Verification" section): scripted end-to-end walkthroughs at the end of each phase.

## What NOT to Do

- **Do not commit secrets.** `.env`, `.env.*` (except `.env.example`), `secrets/`, `*.pem`, `*.key` are all in `.gitignore`. Double-check before every commit.
- **Do not use `parseFloat` on amounts.** Use `decimal.js` or equivalent. A single floating-point cent of drift is a bug that destroys trust in the app.
- **Do not store the SimpleFIN Access URL unencrypted.** Use the encryption helper in `packages/simplefin` with `ENCRYPTION_MASTER_KEY`.
- **Do not let AI tools return raw PII.** Strip at the tool boundary. The PII stripper regex suite is in `packages/ai/pii-stripper.test.ts`.
- **Do not bypass the double-entry invariant.** Any new write path for `entry` must go through `packages/core/entries/` — never construct `entry_line` rows directly in app code.
- **Do not push to `main` directly.** All work goes through feature branches + PRs, even solo work.
- **Do not skip hooks** (`--no-verify`). If a pre-commit hook fails, fix the underlying issue.
- **Do not treat `PROGRESS.md` as documentation.** It's transient session state. Facts that should persist go in `docs/**`.
- **Do not jump into source code without reading `docs/plan.md`.** The plan is the single source of truth for what's supposed to happen.
