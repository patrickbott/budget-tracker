# Budget Tracker

A self-hosted personal finance and budget tracker — the one you actually own. Built because YNAB, Mint, and Excel all fall short in different ways.

## Why this exists

- **YNAB / Mint felt constraining.** Rigid categorization, forced budgeting methodology, weak reporting, no programmatic access to your own data, and not enough AI insight into spending.
- **Excel was clunky.** Hard to maintain, hard to use on a phone, no automation, no live data.
- **This is the middle path.** A polished web app that ingests your real bank data via SimpleFIN, models it cleanly, and layers AI on top — all self-hosted on a small VPS, no vendor lock-in.

## Core features

| Feature | How it works |
|---|---|
| **SimpleFIN ingestion** | Daily pull from SimpleFIN Bridge. You pay SimpleFIN directly (~$15/yr); the app never sees bank credentials |
| **Flexible categorization** | Custom categories (nestable), rules engine with conditions + actions, auto-categorization that learns from your corrections |
| **Hybrid budgeting** | Each category is either a **hard cap** (traditional envelope-style limit) or a **forecast target** (goal to hit). Mix freely |
| **Hybrid multi-user** | Shared household accounts/budgets alongside personal accounts/budgets, all in the same family |
| **AI analysis (first-class)** | Chat with your data, automated weekly/monthly insights, rule-inducing auto-categorization, proactive budget coaching |
| **Net worth tracking** | Bank accounts + credit cards + loans + manual asset valuations (house, car, etc.) in one timeline |
| **PWA** | Installs to phone home screen, works on desktop, push notifications for alerts |

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript 5 |
| Database | Postgres 16 |
| ORM | Drizzle |
| Auth | Better Auth (with `organization` plugin = households) |
| UI | Tailwind CSS 4 + shadcn/ui + Recharts + Tanstack Table |
| AI | Anthropic SDK directly — Claude Opus 4.6 (chat) + Haiku 4.5 (batch) |
| Background jobs | pg-boss (Postgres-backed, no Redis) |
| PWA | `@ducanh2912/next-pwa` |
| Testing | Vitest + Playwright |
| Deployment | Docker Compose on a Hetzner VPS, Caddy reverse proxy with auto-TLS |

See [`docs/architecture.md`](docs/architecture.md) for details and [`docs/plan.md`](docs/plan.md) for the full implementation blueprint.

## Repository layout

```
budget-tracker/
├── apps/web/               # Next.js app (Phase 0b+)
├── packages/
│   ├── db/                 # Drizzle schema + migrations
│   ├── core/               # Framework-agnostic business logic
│   ├── simplefin/          # SimpleFIN Bridge client
│   ├── ai/                 # Anthropic client + typed financial query tools
│   └── jobs/               # pg-boss workers
├── infra/                  # Docker Compose, Caddyfile, VPS playbook
├── docs/                   # All project documentation
│   ├── plan.md             # Implementation blueprint (single source of truth)
│   ├── architecture.md     # System overview
│   ├── data-model.md       # ERD + invariants
│   ├── simplefin-notes.md  # SimpleFIN quirks + gotchas
│   ├── ai-tools.md         # Typed financial query tool reference
│   ├── development.md      # Local dev setup
│   ├── deployment.md       # VPS deploy runbook
│   └── decisions/          # ADRs for major architecture decisions
├── scripts/                # Dev / ops shell scripts
├── .claude/                # Claude Code project skills (session-start, /start, /review-workers, etc.)
├── CLAUDE.md               # Persistent agent context (read first by every Claude session)
├── PROGRESS.md             # Transient session-state log (what happened last session, what's next)
└── README.md               # This file
```

## Current status

**Phase 0a — Project scaffolding** ✅ complete (this commit)

Next up: **Phase 0b — Code scaffolding** via `/start` → two parallel Claude instances. See [`PROGRESS.md`](PROGRESS.md) for the up-to-the-minute session state.

See the full phase plan in [`docs/plan.md`](docs/plan.md#phased-rollout).

## Working on this project with Claude Code

This repo is built around a **coordinator + two-worker parallel Claude workflow**. The short version:

1. **At the start of a session**: run `/session-start` (for solo work) or `/start` (to spawn parallel workers)
2. **For parallel work**: `/start` reviews the plan + `PROGRESS.md`, proposes two disjoint work packets, and writes `PROMPT_INSTANCE_A.md` + `PROMPT_INSTANCE_B.md`. You open two new Claude Code sessions and run `/start-worker A` and `/start-worker B` in each — they execute in git worktrees at `.worktrees/instance-A` and `.worktrees/instance-B`
3. **After the workers finish**: run `/review-workers` in the coordinator session — it reviews both PRs, produces per-PR verdicts, and hands back a merge decision
4. **At the end of a session**: run `/session-end` to update `PROGRESS.md`

See [`CLAUDE.md`](CLAUDE.md) for the full session protocol and conventions.

## Quick start (Phase 0b+ — once code scaffolding lands)

> Not yet — Phase 0a is a docs-and-scaffolding-only baseline. `package.json`, `docker-compose.dev.yml`, and the actual source tree land in Phase 0b via the parallel-Claude workflow described above.

When Phase 0b lands, the quick start will be approximately:

```bash
cp .env.example .env.local            # fill in secrets
docker compose -f infra/docker-compose.dev.yml up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

See [`docs/development.md`](docs/development.md) for the full flow (updated as each phase lands).

## License

TBD — personal project, not yet licensed for distribution.
