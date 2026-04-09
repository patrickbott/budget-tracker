# Budget Tracker — Implementation Plan

## Context

You want a self-hosted personal finance and budget tracker that escapes the specific frustrations of YNAB, Mint, and your earlier Excel attempt. The things that matter to you (from our brainstorming conversation):

- **Flexible categorization** — no forced taxonomy, rules you own, auto-categorization that's explainable
- **No forced budgeting methodology** — YNAB's zero-based envelope system felt too rigid; you want a hybrid where each category can be either a hard cap OR a forecast target, per your choice
- **Strong exploratory reporting** — ability to slice data any way, not locked to canned reports
- **You own the data** — full API, the app is yours, no vendor lock-in
- **AI as a first-class feature**, not a bolt-on:
  1. Chat with your data ("how much did I spend on coffee last month?")
  2. Passive weekly/monthly insights delivered automatically
  3. Auto-categorization that learns from corrections
  4. Proactive coaching ("at this pace you'll blow dining budget by $80")
- **Hybrid shared + personal multi-user** — shared household accounts/budgets alongside individual-only accounts and budgets. Small scale (a few people)
- **PWA first, native later** — responsive web app that installs to phone home screen; defer native unless the PWA falls short in practice
- **Phased but fully-designed** — we plan the whole arc; we implement in phases with check-ins between

**Data source:** SimpleFIN Bridge. Confirmed still the right call for 2026 (GoCardless stopped onboarding new customers Sept 2025; Plaid ruled out; Teller is comparable but the trust model is worse for self-hosting). End user pays SimpleFIN directly (~$15/yr); the app developer has zero aggregator cost and zero PII storage risk.

**Inspiration (patterns borrowed, NOT code forked):** Maybe Finance (polymorphic Account + Entry data model, Family tenant), Firefly III (double-entry journal-with-rows), Actual Budget (rules engine with stages + rule induction from corrections), Lunch Money (recurring-with-missing-dates, to_base currency pre-conversion).

## Approach

Fresh TypeScript build. Next.js 15 + Postgres + Drizzle + Better Auth + Anthropic SDK on a Hetzner VPS. Steal the best data-model ideas from the OSS projects above but write the code ourselves — this gives you the stack you'll enjoy maintaining, AI-first architecture from day one, and clean isolation of concerns without inheriting anyone else's legacy baggage.

### Tech stack (concrete versions)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15** (App Router) + TypeScript 5 | Server components + server actions = minimal API boilerplate; best-in-class streaming AI UX; mature PWA support |
| Database | **Postgres 16** | JSONB for SimpleFIN `extra` blobs, rich date/window functions for reporting, row-level security for family scoping, fulltext search on transactions |
| ORM | **Drizzle ORM** | Type-safe SQL, lightweight runtime (better than Prisma for a small VPS), close-to-SQL mental model, excellent migrations |
| Auth | **Better Auth** | Self-hostable, TS-native, has an `organization` plugin that maps cleanly to household; supports email+password, magic link, passkeys |
| UI | **Tailwind CSS 4** + **shadcn/ui** | Fast to build, unopinionated, polished by default |
| Charts | **Recharts** | Declarative React, good defaults, mobile-friendly |
| Tables | **Tanstack Table v8** | Virtualized, sortable/filterable, fast on large transaction lists |
| AI | **Anthropic SDK** directly (not Vercel AI SDK) | Opus 4.6 for chat, Haiku 4.5 for batch work (categorization, insights); native tool_use API for our typed financial query tools |
| Jobs | **pg-boss** | Postgres-backed job queue — no Redis, one less service |
| PWA | **@ducanh2912/next-pwa** | Manifest, service worker, offline shell, iOS 16.4+ push |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | Standard TS testing stack |
| Package mgr | **pnpm** | Fast, strict, good with monorepos if we split later |
| Reverse proxy | **Caddy** | Auto-TLS via Let's Encrypt, single-line config |
| Deployment | **Docker Compose** on a VPS | Portable, easy backups, moves between hosts |

### Hosting (VPS)

- **Provider**: **Hetzner CX22** (~$4.50/mo, 2 vCPU, 4GB RAM, 40GB SSD, Ashburn VA for US latency) — best perf/$ in 2026. Alternative: **CAX11** (ARM, ~$3.50/mo) if you want to squeeze costs; Node + Postgres run fine on ARM64
- **OS**: Ubuntu 24.04 LTS, SSH key-only, root login disabled, unattended-upgrades, fail2ban, ufw open on 22/80/443 only
- **DNS**: Cloudflare (free tier), proxied for DDoS + a bit of WAF. Needs a domain — either one you already own (subdomain) or a ~$12/yr new one (Porkbun / Cloudflare Registrar)
- **TLS**: Caddy auto-issues Let's Encrypt certs — zero config
- **Private admin access**: Tailscale installed on the VPS (optional) for SSH from anywhere without exposing SSH publicly
- **Backups**: nightly `pg_dump` → Backblaze B2 (~$0.01/mo for this scale), encrypted client-side with `age`
- **Monitoring**: Healthchecks.io (free) ping from the sync cron; UptimeRobot (free) for public HTTP check

**Open decision before Phase 1 deploy**: do you own a domain to use as a subdomain (e.g. `budget.yourdomain.com`), or will you register a new one? The plan assumes a new dedicated domain unless you say otherwise.

### Data model (the single most important decision)

Directly inspired by Maybe Finance + Firefly III + Lunch Money. The key idea: **one unified timeline of financial events** that works for bank transactions, transfers, manual entries, and asset valuations alike, via two layers of polymorphism.

```
family (tenant root)
  ├── user (via membership — roles: owner, member)
  ├── account (polymorphic by account_type)
  │     ├── depository_account (checking, savings)
  │     ├── credit_card_account
  │     ├── investment_account
  │     ├── loan_account (mortgage, auto, student)
  │     ├── property_account (house, car — manual valuations)
  │     └── other_asset / other_liability
  ├── entry (polymorphic by entryable_type) ── every financial event
  │     ├── transaction (standard money in/out)
  │     ├── transfer (internal between own accounts)
  │     ├── valuation (manual "worth $X on date Y")
  │     └── (trade — phase 5, for investment holdings from CSV imports)
  ├── entry_line (Firefly-style double-entry)
  │     └── signed amount rows; every entry's lines sum to zero
  ├── category (per-family, nestable, parent_id)
  ├── rule (Actual-style: conditions[], actions[], stage: pre|default|post)
  ├── budget (per category, per period)
  │     └── budget_mode: hard_cap | forecast  ← your hybrid flexibility
  ├── recurring (cadence + expected_dates + missing_dates computed)
  ├── goal (savings, debt_payoff, net_worth_target)
  ├── connection (SimpleFIN access URL, encrypted at rest with a VPS-local key)
  └── sync_run (audit log: gzipped raw /accounts JSON, kept 7 days)
```

**Key invariants enforced at the DB layer:**
- Every row scopes through `family_id` (Postgres row-level security policies enforce this at query time — app cannot accidentally leak data across families)
- Every `entry`'s `entry_line`s must sum to zero (CHECK constraint + trigger)
- Account `visibility` is `household` or `personal`; `personal` requires a non-null `owner_user_id`; queries filter automatically based on the current user's membership
- Amounts stored as `NUMERIC(19,4)` — never float; SimpleFIN delivers amounts as strings and we parse with a decimal library

**Why double-entry under the hood:** splits, transfers, refunds, and multi-currency all collapse into one mechanism. The user never sees "debit/credit" — the UI shows "transactions". But under the hood, reporting is trivial (`SUM(amount) WHERE account_type = 'depository' AND ...`), and the schema enforces balance. This is the Firefly III lesson.

### SimpleFIN sync strategy

- **Cadence**: daily pull at a randomized hour per-family (e.g., 4–6am local time). SimpleFIN upstream only refreshes ~once/24h, so more frequent pulls waste quota
- **Window**: 7-day trailing overlap from `max(balance_date)` across accounts to catch pending→posted transitions and late-posting transactions
- **Dedup**: upsert on `(account_internal_id, simplefin_txn_id)`. On conflict, allow `pending=true → pending=false` transition; otherwise no-op
- **Pending→posted with new ID**: secondary match on (amount, posted_date ±2d, description prefix) to detect and merge
- **Amount handling**: parse SimpleFIN string amounts with `decimal.js` into `NUMERIC(19,4)`, never `parseFloat`
- **Transfer detection**: post-insert pass finds opposite-sign transactions across owned accounts within ±3 days / ±$0.01 and flags as candidate transfers; user confirms in UI (or an auto-confirm rule does it)
- **Re-link UI**: when SimpleFIN account IDs change (on re-linking), a UI walks the user through mapping old→new account IDs so historical data stays attached
- **Errors**: per-connection `errlist` entries surface as a banner/badge ("Bank X needs re-authentication")
- **Rate limit**: track quota used; back off on warning; alert user if a connection is disabled
- **Credentials at rest**: Access URL encrypted with a key derived from a VPS-local secret + user password hash (so stealing the DB without the running app leaks nothing usable)
- **Audit log**: every `sync_run` stores gzipped raw `/accounts` JSON for 7 days — invaluable for debugging ghost transactions

### AI architecture

**Typed financial query tool-calling, NOT RAG over CSVs.** The LLM does not see transaction rows. It calls functions with typed arguments and receives typed, PII-stripped results.

The same ~15 tools power all four AI features (chat / auto-cat / insights / coaching):

| Tool | Purpose |
|---|---|
| `get_net_worth(as_of_date)` | Asset – liability sum, broken out by account type |
| `spending_by_category(start, end, filters)` | Aggregates, excluding transfers |
| `cashflow(period, granularity)` | Income – expense by month/week |
| `find_transactions(query, filters, limit)` | Full-text + structured search, limited |
| `budget_status(period)` | Per-category actual vs cap/forecast, status color |
| `recurring_status()` | Recurring series + missing_dates ("rent is 3 days late") |
| `compare_periods(a, b, dimensions)` | Period-over-period deltas |
| `forecast_month_end(category?)` | Linear + trend-adjusted projection |
| `explain_variance(category, period)` | "Why is dining up 40%" — finds driver transactions |
| `find_subscriptions()` | Detects recurring small-amount charges, flags stale ones |
| `saving_opportunities()` | Surfaces high-spend categories, unused subscriptions, fee accumulation |
| `propose_rule(pattern)` | Drafts a categorization rule from an example transaction |
| `get_goal_progress(goal_id?)` | Progress vs target, projected completion |
| `list_categories()` / `list_accounts()` | Directory lookups the model uses to map names → ids |
| `run_read_query(sql)` | Escape-hatch read-only SQL, scoped to current family via RLS — used sparingly for questions the typed tools can't express |

**PII stripping happens at the tool boundary.** Each tool's return shape has no emails, no phone numbers, no account numbers, no user names — only category labels, amounts, dates, and internal IDs. The model cannot accidentally leak something it never saw.

**Four features, same tools:**
- **Chat** (Opus 4.6): streamed responses, tool_use loop, conversation history per-user
- **Auto-categorize** (Haiku 4.5): batch job after each SimpleFIN sync; runs rules engine first, then Haiku proposes categories AND rules for unmatched transactions; user accepts rules in a review UI (Actual's rule-induction pattern)
- **Weekly / monthly insights** (Haiku): pg-boss cron → LLM composes a markdown report using the same tools → saved to `insights` table → optionally emailed via Resend
- **Proactive coaching** (Haiku): on dashboard load + nightly; uses `forecast_month_end` + `budget_status` + `recurring_status` to generate 0–3 actionable alerts per family

**Cost control:**
- Haiku for all batch work (~$0.25 / 1M input tokens in 2026 — negligible at this scale)
- Opus only for interactive chat
- Prompt cache on system prompt + tool definitions
- Hard monthly spend cap per family (default $10), alert when 80% consumed

### Auth and multi-user

- **Better Auth** with email+password and passkeys (WebAuthn)
- Better Auth `organization` plugin = our `family`; users belong to families via `membership` with a role
- Session storage: Better Auth's default Postgres adapter
- **Row-level security**: a single Postgres policy on every table — `family_id = current_setting('app.current_family_id')::uuid` — set via a connection-scoped session variable from a Drizzle middleware that runs on every request. Belt and suspenders against app-layer bugs
- Account `visibility` ('household' | 'personal') + `owner_user_id` enforced at the app layer + an additional RLS policy: personal accounts only visible to their owner

### Phased rollout

Each phase ends with a working app you can use. The whole arc is designed up front; we check in between phases so the plan can adapt to what you actually want after living with each stage.

**Phase 0a — Project scaffolding + docs (NO source code yet, done first and independently)**

This is the work the user explicitly asked for before any development starts. Everything here is project infrastructure — files, directories, documentation, git setup, agent-workflow tooling. No application source code is written in this phase.

- `git init` in `C:\Users\kbott\projects\budget-tracker` with a thoughtful `.gitignore` (Node, Next, Docker, editor junk, env files) + `.gitattributes` (line endings for Windows/WSL interop)
- `README.md` — project overview, what it is, who it's for, links to docs, a 5-minute "what lives where" tour of the repo
- `CLAUDE.md` — the durable context file every future Claude session will read first. Includes: project goals, tech stack, directory structure, coding conventions, how to run things locally, how to run tests, where the plan lives, how the parallel-Claude workflow is used, what NOT to do (e.g., don't commit env files, don't push to main directly, don't jump into source code without checking the plan first)
- `progress.md` — running log of major milestones, decisions, and phase completions. This is the "chronology" file; phase-by-phase summaries get appended here as work completes
- `docs/` directory with initial scaffolded files (most can be short placeholders; they grow as phases progress):
  - `docs/plan.md` — copy of this plan file (so it's tracked with the repo going forward and editable in-context)
  - `docs/architecture.md` — high-level system diagram + component boundaries
  - `docs/data-model.md` — ERD + invariants (stub now, fills in Phase 0b)
  - `docs/simplefin-notes.md` — quirks, re-link flow, pending→posted handling
  - `docs/ai-tools.md` — the ~15 typed financial query tool reference
  - `docs/decisions/` — an ADR (Architecture Decision Record) directory. First ADR: "Why fresh TypeScript build over forking Maybe Finance." Future major decisions go here
  - `docs/development.md` — local dev setup, env vars, common commands
  - `docs/deployment.md` — VPS provisioning + deploy runbook (stub now)
- `.editorconfig`, `.prettierrc`, `.prettierignore` — consistent formatting from day one
- `.env.example` — template for env vars the app will need (DB URL, Anthropic API key, Better Auth secret, SimpleFIN, etc.)
- **`.claude/` directory with agent-workflow tooling** emulating your context-engine pattern:
  - `.claude/commands/start.md` — slash command that reviews the plan + progress.md + recent git history and proposes **two independent work packets** with prompts for two separate Claude instances to execute in parallel. The prompts are structured so the two instances work on disjoint areas (e.g., "instance A: scaffold packages/db with full Drizzle schema", "instance B: scaffold packages/core with empty type stubs + test harness") and won't step on each other
  - `.claude/commands/review.md` — slash command that reviews what the two instances produced (via `git diff` or by reading the specific files), validates against the plan, identifies conflicts or gaps, and either (a) approves both and appends to progress.md + commits, or (b) flags what needs revision and how
  - `.claude/commands/next-phase.md` — slash command that advances the phase counter in progress.md and proposes the next `/start` work packets
  - `.claude/settings.json` — per-project Claude Code settings (permissions allowlist for the commands the project uses, any hooks)
- Initial git commit: "chore: scaffold project + planning docs"
- This phase does NOT yet install `node_modules`, run `pnpm init`, create `package.json`, or touch source code. That comes in Phase 0b

**Phase 0b — Code scaffolding** (done via `/start` + two parallel Claude instances)
- `pnpm init`, `pnpm-workspace.yaml`, monorepo structure (`apps/web`, `packages/db`, `packages/core`, `packages/simplefin`, `packages/ai`, `packages/jobs`)
- Next.js 15 App Router in `apps/web`, TypeScript 5, ESLint, Prettier, Vitest, Playwright
- Docker Compose files: `docker-compose.dev.yml` + `docker-compose.prod.yml` (`app`, `postgres`, `caddy`)
- Drizzle schema in `packages/db/schema/`: full data model (all tables from the ERD above), generated migrations
- Better Auth wired up in `apps/web` with families + memberships
- Basic UI shell: marketing landing → auth → app layout with nav
- Seed script: one family, two users, example accounts/entries, for dev
- CI in `.github/workflows/`: lint + typecheck + unit tests on push
- VPS provisioning playbook at `infra/vps-setup.md`
- `/review` the two instances' work before commit

### Parallel Claude workflow (your context-engine pattern)

The user works by dispatching **two independent Claude instances in parallel** for most development work, then reviewing what they produced before integrating. This repo has three slash commands scaffolded in Phase 0a to support that pattern:

1. **`/start`** — you run this in the orchestrating session. It reads the plan, reads `progress.md`, and proposes two disjoint work packets, each with (a) a goal, (b) the files/directories in scope, (c) a prompt to paste into a separate Claude instance, (d) an explicit note about what the OTHER instance is doing so both stay in their lanes. It prints the two prompts in separate code blocks, ready to copy
2. **(You manually run the two instances)** — new Claude sessions, each fed one prompt. They work in parallel on isolated scopes
3. **`/review`** — back in the orchestrating session. It reviews the working tree (via `git diff` and `git status`), validates both packets against the plan, looks for conflicts, scope creep, missing tests, or gaps. Outputs: approve + append to `progress.md` + commit, OR specific revision instructions per instance
4. **`/next-phase`** — once a phase is complete, advances the progress log and proposes the first `/start` for the next phase

This workflow formalizes the "design up front, implement in parallel, review before integration" loop the user prefers, and keeps the plan file as the single source of truth for what's supposed to happen vs what's been done.

**Phase 1 — SimpleFIN MVP**
- SimpleFIN connection flow: paste Setup Token → exchange → store Access URL (encrypted) → first pull
- Daily sync job (pg-boss cron) with 7-day trailing window
- Transaction ingest: creates `entry` + `entry_line` pairs against the matched account and a classifier-placeholder category
- Transactions page: Tanstack Table with filters, search, date range, category, account
- Accounts page: list, balances, balance history chart
- Dashboard v1: net worth card, account list, cashflow chart, recent transactions
- Categories: flat list CRUD, manual assignment from transactions page
- Deploy to VPS: first real use

**Phase 2 — Budgeting + rules**
- Budgets CRUD: per category, per period, hybrid `hard_cap | forecast` mode
- Budget status widget (per category: actual vs cap / forecast)
- Rules engine: conditions + actions, stages pre/default/post, auto-ranking by specificity
- Rule editor UI with "apply to matching past transactions" button
- Auto-apply rules on every SimpleFIN ingest
- Transfer detection pass (opposite-sign match across accounts) + review UI
- Recurring detection: identifies repeating merchants/amounts, creates `recurring` entries

**Phase 3 — AI layer**
- Tool implementations: all ~15 typed tools as TS functions with Zod schemas; each scoped by `family_id`
- Anthropic SDK wiring with prompt caching
- Chat UI: streaming messages, tool_use display, conversation history per-user
- Auto-categorization job: after each sync, unmatched transactions → Haiku → proposed category + rule → review inbox
- Weekly insights cron: every Sunday, generate family-level markdown report, save to `insights` table
- Proactive coaching: dashboard widget + nightly alert generation
- Spend cap enforcement: track token usage per family, warn/block at thresholds

**Phase 4 — Goals + advanced net worth + PWA polish**
- Goals CRUD (savings, debt payoff, net worth target), progress tracking, projections
- Manual valuations for property/vehicle/other assets (creates `valuation` entries) — net worth now reflects the whole picture, not just bank balances
- Nested categories (category parent_id relationships)
- PWA: manifest, service worker, install prompts, offline shell
- Push notifications for insights and alerts (iOS 16.4+, Android)
- Mobile UI polish pass

**Phase 5 — Polish (ongoing)**
- Investment holdings via broker CSV import (Fidelity, Schwab, Vanguard formats) — fills the gap SimpleFIN leaves with investment accounts
- Multi-currency (per Lunch Money `to_base` pattern)
- Advanced charts (Sankey for cashflow, treemap for spending)
- Custom dashboards per user
- Export: CSV, OFX, JSON, full DB snapshot
- Mobile refinements / candidate for React Native port if PWA feels lacking

### Critical files / structure to create

```
budget-tracker/
├── apps/web/                 # Next.js app (single-app for now; can split later)
│   ├── app/                  # App Router: layout, pages, server actions
│   │   ├── (auth)/           # login, signup, household select
│   │   ├── (app)/            # authenticated shell
│   │   │   ├── dashboard/
│   │   │   ├── accounts/
│   │   │   ├── transactions/
│   │   │   ├── categories/
│   │   │   ├── budgets/
│   │   │   ├── rules/
│   │   │   ├── recurring/
│   │   │   ├── goals/
│   │   │   ├── insights/     # weekly/monthly AI reports archive
│   │   │   └── chat/         # AI chat UI
│   │   └── api/              # webhooks (SimpleFIN re-auth callback if added later)
│   ├── components/ui/        # shadcn/ui
│   ├── components/domain/    # account-card, transaction-row, budget-ring, chat-message, etc.
│   └── lib/
│       ├── db/               # Drizzle client + RLS middleware
│       ├── auth/             # Better Auth config
│       └── ui/               # formatters, hooks
├── packages/
│   ├── db/                   # Drizzle schema + migrations
│   │   ├── schema/           # one file per domain: family, account, entry, category, rule, budget, ...
│   │   └── migrations/
│   ├── core/                 # framework-agnostic business logic (testable in isolation)
│   │   ├── entries/          # entry creation, double-entry invariant enforcement
│   │   ├── rules/            # rules engine: evaluator, ranker, inducer
│   │   ├── budgets/          # budget status, forecasting math
│   │   ├── transfers/        # transfer detection heuristic
│   │   ├── recurring/        # recurring detection + missing_dates math
│   │   ├── reports/          # spending_by_category, cashflow, net_worth, etc.
│   │   └── types/            # shared types + Zod schemas
│   ├── simplefin/            # SimpleFIN Bridge client: token exchange, /accounts pull, parsing, quota tracking
│   ├── ai/                   # Anthropic client, tool definitions (Zod → JSON schema), tool_use loop, PII stripper
│   └── jobs/                 # pg-boss workers: sync, auto-categorize, weekly-insights, coaching, quota-reset
├── infra/
│   ├── docker-compose.dev.yml
│   ├── docker-compose.prod.yml
│   ├── Caddyfile
│   ├── vps-setup.md          # Ubuntu 24.04 hardening + Tailscale + backup playbook
│   └── backup/               # pg_dump → age encryption → B2 upload script
├── docs/
│   ├── architecture.md
│   ├── data-model.md         # ERD + invariants
│   ├── simplefin-notes.md    # quirks, gotchas, re-link flow
│   └── ai-tools.md           # tool reference
├── .github/workflows/        # lint, typecheck, test, build
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

The `core` package is pure TS with no framework dependencies. Everything in `core` is unit-testable without a browser, a database client, or a network. This matters because the double-entry invariant, rules engine, transfer detection, and budget math are exactly the places where bugs cost real trust.

### Verification

End-to-end after each phase:

- **After Phase 0**: `docker compose up` on laptop boots the stack; `pnpm migrate && pnpm seed` populates dev data; you can log in, see a dashboard skeleton, and run `pnpm test` (unit) + `pnpm test:e2e` (Playwright) green. Deploy the same stack to the VPS using the `infra/vps-setup.md` playbook; visit `https://<your-domain>` and complete signup
- **After Phase 1**: in prod, paste a real SimpleFIN Setup Token, see accounts + transactions populate from your real banks within a few minutes; verify amounts match your bank's website; let the daily sync job run for 2–3 days and verify no dupes, no drift, no errors
- **After Phase 2**: create 3 hard-cap categories + 3 forecast categories, verify budget widgets, create a few rules, re-run over historical transactions, verify expected reclassifications; manually create two transfers (one in each direction between owned accounts) and verify detection; verify recurring detection identifies known subscriptions
- **After Phase 3**: ask Claude chat 5 representative questions (spend on coffee, net worth trend, where did money go, forecast next month's dining, show subscriptions); verify tool_use logs show the right calls; verify PII stripper drops account numbers / emails in a red-team test; let weekly insights job run, read the report, verify it's accurate against the actual data; verify token spend is under $0.10 for a week of real use
- **After Phase 4**: add a manual valuation for a property, verify net worth includes it; install as PWA on iOS + Android home screen, verify it opens standalone; trigger a push notification from a weekly insight
- **After Phase 5**: import a real broker CSV, verify investment totals; export full DB to JSON and reimport clean

Automated tests that must exist throughout:

- Unit: double-entry invariant (every entry sums to zero), rules evaluator (condition operators, action application, stage ordering), transfer detection (positive/negative/edge cases), budget math (hard_cap vs forecast status logic), SimpleFIN parser (amounts, pending transitions, truncated descriptions, `errlist`), PII stripper (regex suite for emails/phones/names/account numbers)
- Integration: full SimpleFIN ingest from recorded JSON fixtures (happy path, pending transition, re-link, rate-limit, `errlist` with actionable error), rules engine against a seed set of 100 transactions, AI tool calls against a test family
- E2E (Playwright): signup → household create → add dev SimpleFIN (using a fake server that replays fixtures) → see transactions → create rule → create budget → run chat query → see insight generate

## Open decisions (need your input before Phase 1 deploy)

1. **Domain name**: do you already own a domain to use a subdomain of (e.g. `budget.<yours>`), or should Phase 0 include registering a new one (~$12/yr, Porkbun or Cloudflare Registrar recommended)?
2. **VPS provider**: plan assumes Hetzner CX22 (~$4.50/mo, Ashburn VA). Happy to switch to DigitalOcean, Vultr, Linode, or Fly.io if you prefer — let me know during Phase 0
3. **SimpleFIN Bridge account**: you (the end user) will need to sign up at `https://beta-bridge.simplefin.org/simplefin/create` and pay the ~$15/yr. Can do this during Phase 1 when we're ready to ingest real data
4. **Email provider for insights** (Phase 3): Resend (~free tier is generous) or skip email entirely and only show insights in-app. Decide during Phase 3
5. **Off-site backup target**: Backblaze B2 (assumed), or S3, or don't bother for v1? Decide during Phase 0 deploy

None of these block starting implementation — we can begin Phase 0 immediately and resolve these as they come up.
