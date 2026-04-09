---
id: 0001
title: Fresh TypeScript build over forking Maybe Finance / Actual Budget / Firefly III
status: accepted
date: 2026-04-09
deciders: kbott
tags: [architecture, stack, foundation]
---

# ADR 0001 — Fresh TypeScript build over forking an existing OSS finance tracker

## Status

**Accepted** — 2026-04-09. Basis for all of Phase 0a and Phase 0b work.

## Context

Budget Tracker needs a self-hosted personal finance tracker that:

- Ingests US bank data via SimpleFIN Bridge (the user has already ruled out Plaid)
- Supports hybrid shared-household + personal data scoping
- Supports hybrid budgeting modes (hard-cap envelope-style AND forecast-target) per category
- Makes **AI analysis a first-class feature** — chat, passive insights, auto-categorization, proactive coaching
- Runs on a small VPS (Hetzner CX22-class) with Docker Compose
- Ships as a PWA first, native later
- Is phased-but-fully-designed — the whole arc planned up front, implemented in measured phases

During brainstorming we evaluated three broad paths:

### Option A — Fork `we-promise/sure` (active community fork of Maybe Finance)
Maybe Finance had an excellent polymorphic Account + Entry data model, Family-as-tenant, and a working AI Copilot. They shut down in July 2025 and the `we-promise/sure` community fork is the active successor. Forking would give us ~80% of the data model and UI scaffolding already built.

**Pros:**
- Fastest path to a working product
- Proven data model (we'd copy it anyway)
- Existing Family tenant model
- AI assistant already wired (though to OpenAI, not Claude)
- Investment account scaffolding already exists

**Cons:**
- **Ruby on Rails stack** — productive but out of fashion for AI-heavy work, and the user has no strong preference for Ruby
- **Plaid-first integration** — we'd need to rip out Plaid and wire in SimpleFIN, which is non-trivial because their Account/Entry sync logic assumes Plaid's shape
- **Inherited opinions** — Maybe's budget model, category model, and UI conventions would set the baseline and pushing back against them is friction forever
- **Fork maintenance tax** — upstream drift, merge conflicts, pressure to either stay current or diverge
- **AI architecture grafted** — Maybe's Copilot uses OpenAI; we'd swap in Claude, redesign PII handling, and re-tune the tool set. By the time we're done, we've rewritten most of it
- **Hybrid shared/personal data model is not native** — Maybe has Family but not per-account visibility scoping; we'd add it on top

### Option B — Fork Actual Budget (TypeScript)
Actual Budget is a mature TypeScript + React + SQLite local-first finance app with an excellent CRDT sync model and a best-in-class rules engine. It has first-class SimpleFIN integration.

**Pros:**
- Same language as the rest of our stack (TypeScript)
- CRDT sync is technically impressive and genuinely novel
- Working SimpleFIN integration with gotchas already handled (pending transitions, re-link, etc.)
- Excellent rules engine with auto-ranking and stages
- Active maintenance

**Cons:**
- **Locked to envelope budgeting** — zero-based "every dollar a job", which the user explicitly rejected as the YNAB experience that didn't fit
- **Local-first CRDT sync is overkill** — we have a small-scale household, not an offline-first mobile app with intermittent connectivity. CRDT adds complexity without matching our benefit
- **AI is not in-scope for Actual** — we'd graft AI features on top and they'd feel bolted on
- **Budget model would need gutting** — we want hybrid hard-cap + forecast, Actual only supports envelopes. Replacing the budget layer means touching most of the UI
- **Net worth / investment / manual valuation** are not Actual's strengths — we'd be building those anyway

### Option C — Fresh TypeScript build, borrow the best ideas
Build a fresh Next.js 15 + TypeScript + Postgres + Drizzle + Better Auth + Anthropic SDK app, stealing the best ideas from each OSS project:

- Maybe's polymorphic Account + Entry data model + Family tenant
- Firefly III's double-entry journal-with-rows under the hood
- Actual's rules engine with pre/default/post stages + rule induction
- Lunch Money's recurring-with-missing-dates primitive + per-row `to_base` currency pre-conversion
- SimpleFIN integration patterns documented by Actual's PR history and issue threads

**Pros:**
- **Best-fit stack for every requirement** — TypeScript end-to-end, AI-first from day one via Anthropic SDK, Next.js Server Actions for minimal API boilerplate, Drizzle for type-safe SQL, Better Auth for self-hostable org-aware multi-user, runs on a small VPS
- **Hybrid budgeting native** — we design the `budget.mode` column from day one, not on top of an opinionated envelope model
- **Hybrid shared/personal native** — `account.visibility` + `owner_user_id` designed into the schema, not grafted
- **AI as first-class** — the tool set, PII stripping, and spend caps are baked into `packages/ai` from Phase 3, not retrofitted
- **No upstream fork maintenance** — we own the code completely
- **Phased development fits naturally** — we can implement the MVP cleanly in Phase 0b + Phase 1, then layer features in subsequent phases without fighting anyone else's opinions
- **Better debuggability for the user** — nothing in the codebase that the user didn't agree to

**Cons:**
- **More up-front work** — we're writing boilerplate (auth, routing, schema, migrations, CI) that a fork would have for free
- **We have to re-derive the gotchas** — SimpleFIN's pending-posted transitions, re-link handling, description truncation, etc. Mitigated by reading Actual's issue tracker and PR history in `docs/simplefin-notes.md`

## Decision

**Option C — fresh TypeScript build.** We'll steal the best data-model ideas from Maybe Finance + Firefly III + Lunch Money + Actual, but write the code ourselves.

The single biggest factor: the user explicitly wants AI analysis as a first-class feature, and they're frustrated specifically by rigid categorization and forced methodology. Every fork path either (a) forces an opinionated budget model we'd immediately fight, or (b) commits us to a stack that's not AI-native. Starting fresh with a well-designed data model is strictly easier than bending an existing codebase against its grain.

The secondary factor: the user has experience across stacks and is deferring tech choices to us. That means we can pick the stack that best fits the problem, rather than the stack that fits an existing codebase. TypeScript + Next.js + Postgres + Drizzle is the strongest 2026 stack for a self-hosted AI-native web app.

## Consequences

### Positive

- We own the data model completely. The hybrid household/personal and hybrid hard-cap/forecast features are designed in, not layered on.
- AI integration is native from Phase 3 onward — the typed financial-query tool set, PII stripping, and spend caps are built around Claude's `tool_use` API from the start.
- The `packages/core` domain logic is pure TypeScript, framework-free, and fully unit-testable — no inherited coupling to Rails conventions or React component trees.
- No upstream fork maintenance tax.
- The user's stack preferences will shape the choice of individual libraries (Drizzle vs Prisma, Better Auth vs Lucia, etc.) without having to fight existing imports.

### Negative

- **Phase 0b is heavier.** We scaffold the whole monorepo, auth, schema, CI, and Docker stack from zero rather than cloning and tweaking. Mitigated by the phased approach: Phase 0b is ~2-3 weekends and the coordinator + worker pattern parallelizes it.
- **We re-implement well-understood patterns.** Auth flows, migrations, seed scripts, component libraries. Mitigated by leaning on shadcn/ui, Better Auth, Drizzle, etc. — these are mature libraries that shrink the boilerplate.
- **We re-discover SimpleFIN gotchas if we're not careful.** Mitigated by `docs/simplefin-notes.md` which distills the known issues from Actual's issue tracker before Phase 1 touches code.
- **We can't benefit from upstream bug fixes** in Maybe/Actual/Firefly. Mitigated by the small scope of what we actually want — the data model ideas are stable and don't need upstream fixes.

## Alternatives explicitly not chosen

- **Rails + Hotwire** (Maybe Finance's stack): productive for CRUD, weaker story for streaming AI UX and self-hosted resource footprint.
- **FastAPI + React**: excellent AI-adjacent stack, but splitting into two deployments adds ops burden without a proportionate win; Next.js Server Actions give us the same type safety with one deploy target.
- **SvelteKit + Drizzle**: lighter runtime, genuinely attractive, but the Anthropic streaming UX story is slightly thinner than Next.js's and the shadcn ecosystem is smaller. Closer call than the others; Next.js won on ecosystem depth.
- **Fork Lunch Money API structure**: Lunch Money is not open source, so this was "steal API shapes only" which we did anyway.

## References

- Implementation plan: `docs/plan.md`
- Architecture overview: `docs/architecture.md`
- Data model: `docs/data-model.md`
- Brainstorming research findings (in the originating conversation) covered SimpleFIN, Actual Budget, Firefly III, Maybe Finance, and Lunch Money
