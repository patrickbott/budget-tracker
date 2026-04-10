# @budget-tracker/jobs

pg-boss job workers for Budget Tracker.

## Workers

- **sync-connection** — pulls transactions from SimpleFIN Bridge, deduplicates, and upserts entries with balanced double-entry lines.

## Running locally

```bash
# Start dev Postgres (from repo root)
bash scripts/dev-init.sh

# Run tests (from repo root)
pnpm --filter @budget-tracker/jobs test

# Typecheck
pnpm --filter @budget-tracker/jobs typecheck
```

## Architecture

Workers are plain async functions — pg-boss registration happens in `boss.ts` and is separate from the business logic. This makes every worker testable without starting pg-boss.
