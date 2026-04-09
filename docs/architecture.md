# Architecture

> **Status:** Overview. Deep detail lives in `data-model.md`, `simplefin-notes.md`, `ai-tools.md`, and the full implementation blueprint in `plan.md`.

## System overview

Budget Tracker is a single-tenant-per-family self-hosted web app. It pulls bank data from SimpleFIN Bridge on a daily cron, stores it in Postgres under a polymorphic account+entry data model, serves a Next.js 15 UI with server actions, and layers Claude-powered AI features on top via typed function-calling tools.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Users (phone + desktop)                         │
│                                  │                                       │
│                      PWA (installed or browser)                          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         Caddy (auto-TLS, reverse proxy)                  │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        Next.js 15 (apps/web)                             │
│   ┌────────────────────┐  ┌─────────────────┐  ┌──────────────────────┐  │
│   │ Server Components  │  │ Server Actions  │  │ Chat streaming (SSE) │  │
│   │ (read-heavy pages) │  │ (mutations)     │  │ Anthropic tool_use   │  │
│   └────────┬───────────┘  └────────┬────────┘  └──────────┬───────────┘  │
│            │                       │                      │              │
│            ▼                       ▼                      ▼              │
│   ┌────────────────────────────────────────────────────────────────┐     │
│   │  packages/core (framework-agnostic business logic)             │     │
│   │  entries | rules | budgets | transfers | recurring | reports   │     │
│   └────────┬─────────────────────────────────────────┬─────────────┘     │
│            │                                         │                   │
│            ▼                                         ▼                   │
│   ┌────────────────────┐                   ┌──────────────────────┐     │
│   │   packages/db      │                   │   packages/ai         │     │
│   │   Drizzle ORM      │                   │   Anthropic SDK +     │     │
│   │   + RLS middleware │                   │   typed tools +       │     │
│   └────────┬───────────┘                   │   PII stripper        │     │
│            │                                └──────────┬───────────┘     │
└────────────┼───────────────────────────────────────────┼─────────────────┘
             │                                           │
             ▼                                           ▼
┌────────────────────────────┐              ┌──────────────────────────────┐
│  Postgres 16               │              │  Anthropic API               │
│  ├─ schema (Drizzle)       │              │  - Opus 4.6 (chat)           │
│  ├─ RLS per family_id      │              │  - Haiku 4.5 (batch)         │
│  ├─ pg-boss job queue      │              └──────────────────────────────┘
│  └─ full-text search       │
└────────────┬───────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     Background workers (pg-boss)                         │
│   ┌─────────────┐  ┌────────────────┐  ┌─────────────┐  ┌─────────────┐  │
│   │ daily       │  │ auto-          │  │ weekly      │  │ proactive   │  │
│   │ SimpleFIN   │  │ categorize     │  │ insights    │  │ coaching    │  │
│   │ sync        │  │ (Haiku)        │  │ (Haiku)     │  │ (Haiku)     │  │
│   └──────┬──────┘  └────────────────┘  └─────────────┘  └─────────────┘  │
└──────────┼───────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        SimpleFIN Bridge                                  │
│   pull-only, ~24-hour refresh, 24 requests/day, 90-day history max       │
└──────────────────────────────────────────────────────────────────────────┘
```

## Layers

### 1. Ingestion — `packages/simplefin` + `packages/jobs`

- **SimpleFIN client** (`packages/simplefin`): setup-token exchange, `/accounts` pull, response parsing (amounts as strings → Decimal), `errlist` handling, quota tracking, re-link flow
- **Ingest pipeline** (`packages/jobs`): pg-boss workers that run the daily sync, upsert transactions with proper dedup on `(account_internal_id, simplefin_txn_id)`, handle pending→posted transitions, run the transfer-detection pass, and log each run to `sync_run` with the gzipped raw response

### 2. Core domain — `packages/core`

Framework-agnostic TypeScript. No Next.js, no React, no database client imported. Takes plain objects in, returns plain objects out. Everything here is unit-testable in isolation.

Submodules:
- **`entries/`** — constructs `entry` + `entry_line` pairs with the double-entry invariant enforced in code (plus a DB-level CHECK constraint as belt-and-suspenders)
- **`rules/`** — evaluator (conditions → match), ranker (auto-sorts by specificity), inducer (proposes a rule from a user's manual correction), runner (applies rules in pre/default/post stages)
- **`budgets/`** — budget status math for hard-cap vs forecast modes, month-end projection, variance explanation
- **`transfers/`** — opposite-sign matching heuristic for detecting internal transfers between owned accounts
- **`recurring/`** — detects repeating merchant+amount patterns, computes expected cadences, calculates `missing_dates`
- **`reports/`** — the query functions that back both the UI and the AI tools: `spending_by_category`, `cashflow`, `net_worth`, `compare_periods`, etc.
- **`types/`** — shared Zod schemas + TypeScript types

### 3. Data — `packages/db`

- Drizzle schema split into one file per domain (family, user, account, entry, etc.)
- Migrations generated by Drizzle Kit
- `db.ts` exports a connection helper that sets `app.current_family_id` per-request via a Drizzle middleware, so Postgres RLS policies enforce family scoping
- Seed script for dev data

### 4. Presentation — `apps/web`

- Next.js 15 App Router
- Server components for read-heavy pages (dashboard, accounts, transactions, insights archive)
- Server actions for all mutations (no separate API layer needed)
- Better Auth for authentication, using the `organization` plugin for households
- Tailwind + shadcn/ui for the visual layer
- Recharts for charts, Tanstack Table for the transactions grid
- `@ducanh2912/next-pwa` for the manifest, service worker, and installability

### 5. AI — `packages/ai`

- Thin wrapper around the Anthropic SDK
- **Tool definitions**: ~15 typed Zod schemas that describe each financial query tool. Zod → JSON Schema for the `tool_use` API
- **Tool implementations**: thin adapters that call into `packages/core/reports/` with the current family's context, then PII-strip the return value before passing it back to the model
- **PII stripper**: regex-based detection for emails, phone numbers, account numbers, human names (first pass), SSNs. Has its own red-team test suite
- **Tool-use loop**: standard Claude tool-calling pattern (model responds with `tool_use` blocks → we execute → feed results back → model composes final response)
- **Chat streaming**: SSE via Next.js route handler

## Cross-cutting concerns

### Auth + multi-tenancy
Better Auth provides user + session management. The `organization` plugin gives us families, memberships, and roles. Every request is authenticated, and Drizzle middleware sets a Postgres session variable (`app.current_family_id`) from the session, which RLS policies use to scope every query. **If the app layer has a bug and tries to read across families, the database refuses.**

### Encryption at rest
The SimpleFIN Access URL is the one long-lived credential we store. It's encrypted with a key derived from the per-app `ENCRYPTION_MASTER_KEY` (32 bytes, base64) + a per-family salt. If someone steals the database but not the running app's env, the credentials are unusable.

### Background jobs
`pg-boss` uses Postgres as the queue — one less service to run. Workers run in-process in a separate Node entrypoint from the web server. Cron jobs: daily sync, nightly coaching, weekly insights, monthly quota reset.

### Testing layers
- **Unit** (`packages/core`): pure functions, Vitest, runs in < 5s. Target: every function in `core` has at least one test.
- **Integration** (Vitest with a disposable Postgres): exercises the DB + Drizzle + RLS + the double-entry invariant + SimpleFIN parser against recorded fixtures
- **E2E** (Playwright): signup → household → connect fake SimpleFIN → see transactions → create rule → create budget → run chat query

## Key invariants

These are enforced in code AND database. If you're writing a new code path that touches these, add a test.

| Invariant | Enforced by |
|---|---|
| Every `entry`'s `entry_line`s sum to zero | CHECK constraint + trigger (DB) AND `packages/core/entries/` builder (app) |
| Every row scopes to a family | Postgres RLS policy (DB) AND Drizzle middleware (app) |
| Amounts are never `parseFloat`'d | `decimal.js` in app, `NUMERIC(19,4)` in DB, ESLint rule banning `parseFloat` in the monorepo |
| Personal accounts visible only to owner | RLS policy + app-layer filter |
| AI tools never return raw PII | PII stripper at tool boundary, dedicated red-team test suite |
| Hard monthly AI spend cap per family | Token usage tracked in DB, checked before every Anthropic call |
