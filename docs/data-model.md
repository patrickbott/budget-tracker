# Data Model

> **Status:** Stub. Full schema lands in Phase 0b when Drizzle files are written under `packages/db/schema/`. This doc is the conceptual reference; the code in `packages/db/schema/` is the source of truth.

## Design principles

1. **Polymorphic account + polymorphic entry.** One unified timeline of financial events covers bank transactions, transfers, manual valuations, and (later) investment trades. Inspired by Maybe Finance.
2. **Double-entry under the hood.** Every `entry` has ≥2 signed `entry_line` rows that sum to zero. Splits, transfers, refunds, and multi-currency collapse into one mechanism. Inspired by Firefly III. UI users never see "debit/credit" — they see "transactions".
3. **Family is the tenant root.** Every row scopes through `family_id`, enforced by Postgres row-level security, not just the app layer.
4. **Amounts as `NUMERIC(19,4)`.** Never float. SimpleFIN delivers strings; we parse with `decimal.js`.
5. **Invariants in the database.** CHECK constraints and triggers pin invariants that must never be violated: balance, non-null where required, type polymorphism via partial unique indexes.

## Entities (conceptual)

### `family`
The tenant root. Created when the first user signs up and invites others (or just works solo). Maps onto Better Auth's `organization` primitive.

- `id`, `name`, `created_at`, `base_currency` (ISO 4217, default `USD`), `timezone` (IANA, e.g. `America/New_York`)

### `user`
Authentication identity. A user can belong to one or more families via `membership`.

- `id`, `email`, `name`, `created_at`
- Managed by Better Auth — we don't write this table directly except via Better Auth's own API

### `membership`
Joins `user` to `family` with a role.

- `family_id`, `user_id`, `role` (`owner` | `member`), `created_at`

### `account`
Polymorphic. Every financial account you hold — checking, savings, credit cards, loans, brokerages, real estate.

- `id`, `family_id`, `name`, `account_type` (enum: `depository` | `credit_card` | `investment` | `loan` | `property` | `crypto` | `other_asset` | `other_liability`), `currency` (ISO 4217, defaults to family base), `visibility` (`household` | `personal`), `owner_user_id` (nullable; required when `visibility = 'personal'`)
- `balance`, `balance_as_of` — last-known authoritative balance, per SimpleFIN `balance-date`
- `is_manual` (bool) — true if not synced via SimpleFIN
- `is_closed` (bool) — hide from default views
- `simplefin_account_id` (nullable) — the opaque SimpleFIN account ID; may change on re-link
- `connection_id` (nullable) — FK to `connection`
- `created_at`, `updated_at`

**Polymorphic detail** is held in typed sub-tables via Postgres table inheritance OR a JSONB `type_data` column (decision deferred to Phase 0b). Examples:
- `depository_account`: subtype (`checking` | `savings`), institution_name
- `credit_card_account`: credit_limit, apr, statement_day
- `loan_account`: original_principal, interest_rate, term_months, first_payment_date, payoff_date
- `investment_account`: institution_name, account_subtype (`brokerage` | `ira` | `roth` | `401k` | `hsa`)
- `property_account`: address, purchase_date, purchase_price
- Etc.

### `connection`
A SimpleFIN Bridge connection. One row per linked-institution set (from the user's perspective, one SimpleFIN Bridge account).

- `id`, `family_id`, `access_url_encrypted` (text, encrypted with `ENCRYPTION_MASTER_KEY` + family salt), `nickname`, `status` (`active` | `needs_reauth` | `disabled`), `last_synced_at`, `last_error`, `created_at`

### `sync_run`
Audit log of every SimpleFIN pull. Retained 7 days (pruned nightly) — invaluable for debugging.

- `id`, `connection_id`, `started_at`, `finished_at`, `status`, `request_range_start`, `request_range_end`, `raw_response_gzip` (bytea), `transactions_created`, `transactions_updated`, `errlist_json`

### `entry`
The single unified financial-event table. Polymorphic by `entryable_type`.

- `id`, `family_id`, `entry_date` (the "when did this happen" date), `entryable_type` (`transaction` | `transfer` | `valuation` | `trade`), `entryable_id`, `description`, `notes`, `created_at`, `updated_at`, `source` (`simplefin` | `manual` | `import` | `rule`)

**Sub-types:**
- **`transaction`** — the standard bank-transaction case. Linked to one account. Amount derived from `entry_line`.
- **`transfer`** — movement between two owned accounts. Has `from_account_id`, `to_account_id`. Auto-detected by the transfer heuristic, confirmed by user.
- **`valuation`** — a point-in-time manual declaration of an account's value ("the house is worth $X on date Y"). Used for property, other_asset, crypto.
- **`trade`** — Phase 5, for investment holdings imported from broker CSVs. Has `security_id`, `quantity`, `price`, `fees`.

### `entry_line`
The double-entry row. Each `entry` has ≥2 rows; they must sum to zero.

- `id`, `entry_id`, `account_id` (nullable — can point at a virtual income/expense/equity account), `amount` (`NUMERIC(19,4)`, signed), `category_id` (nullable — only set on the expense-side line of a transaction entry), `memo`
- CHECK constraint + trigger enforces `SUM(amount) OVER (PARTITION BY entry_id) = 0`

### `category`
Spending/income categories, nestable.

- `id`, `family_id`, `name`, `parent_id` (nullable, self-ref), `kind` (`income` | `expense` | `transfer` | `equity`), `color`, `icon`, `sort_order`, `is_archived`

### `rule`
Actual-style rules engine.

- `id`, `family_id`, `name`, `stage` (`pre` | `default` | `post`), `enabled`, `specificity_score` (int, auto-computed), `created_by_user_id`, `created_from` (`manual` | `induced`), `created_at`
- `conditions_json` — array of condition objects (field + operator + value). Fields: description, amount, account, date, currency. Operators: is, is_not, contains, does_not_contain, matches_regex, one_of, greater_than, less_than, between
- `actions_json` — array of action objects. Action types: set_category, set_description, set_memo, add_tag, mark_as_transfer, skip

### `budget`
Per category, per period.

- `id`, `family_id`, `category_id`, `period` (`monthly` | `weekly` | `yearly`), `period_start`, `amount` (`NUMERIC(19,4)`), `mode` (`hard_cap` | `forecast`), `rollover` (`none` | `rollover_positive` | `rollover_all`)
- The hybrid flexibility: each category can be either mode, freely mixed

### `recurring`
Lunch-Money-style recurring series.

- `id`, `family_id`, `name`, `cadence` (`weekly` | `monthly` | `quarterly` | `yearly`), `cadence_interval`, `expected_amount`, `amount_tolerance_pct`, `expected_account_id`, `category_id`, `last_matched_entry_id`, `last_matched_date`, `missing_dates` (computed: expected dates with no matching entry yet)
- Auto-detected from the transactions history; user can confirm/edit

### `goal`
Savings, debt payoff, net worth targets.

- `id`, `family_id`, `name`, `goal_type` (`savings` | `debt_payoff` | `net_worth_target`), `target_amount`, `target_date`, `linked_account_ids[]`, `status` (`active` | `achieved` | `abandoned`), `created_at`
- Progress computed from current account balances and historical entries

### `insight`
Archive of AI-generated weekly/monthly insight reports.

- `id`, `family_id`, `period` (`weekly` | `monthly`), `period_start`, `period_end`, `markdown_body`, `tool_calls_json` (audit trail of which tools the LLM used), `generated_at`, `tokens_used`, `cost_usd`

### `ai_usage`
Token/cost accounting per family, per day.

- `family_id`, `date`, `model`, `input_tokens`, `output_tokens`, `cost_usd`
- Aggregated for the hard monthly spend cap enforcement

### `chat_conversation` + `chat_message`
Chat history per user (not per family — chat is a personal interaction).

- `chat_conversation`: `id`, `user_id`, `family_id`, `title`, `created_at`, `updated_at`
- `chat_message`: `id`, `conversation_id`, `role` (`user` | `assistant` | `tool`), `content`, `tool_calls_json` (if any), `created_at`

## Key queries (which should be cheap)

The RLS policies make every query implicitly family-scoped. Index strategy is oriented around these queries.

| Query | Frequency | Index hint |
|---|---|---|
| Recent transactions for an account (paginated) | Every page load | `(family_id, account_id, entry_date DESC)` |
| Spending by category for a date range | Dashboard, AI tools | `(family_id, category_id, entry_date)` composite |
| Net worth at a point in time | Dashboard | Aggregate over `entry_line.amount` grouped by `account.account_type` |
| Transaction full-text search | Transactions page | GIN index on `to_tsvector(description)` |
| Budget status for current period | Dashboard, AI tools | `(family_id, category_id, period_start)` |
| Unmatched recurring expected dates | AI coaching | `recurring.missing_dates` computed column |
| Duplicate SimpleFIN transaction check | Every sync | Unique `(account_id, simplefin_txn_id)` |

## Invariants — summary checklist

- [ ] `SUM(entry_line.amount) OVER (PARTITION BY entry_id) = 0` for every entry
- [ ] Every row has a non-null `family_id` that matches `current_setting('app.current_family_id')` (RLS)
- [ ] `account.visibility = 'personal'` ⇒ `account.owner_user_id IS NOT NULL` AND that user is a member of `family_id`
- [ ] Amounts are `NUMERIC(19,4)`; no floating-point types anywhere
- [ ] `category.parent_id` creates no cycles
- [ ] `connection.access_url_encrypted` is never stored plaintext
- [ ] Unique `(account_id, simplefin_txn_id)` prevents duplicate SimpleFIN imports
- [ ] `entry.source = 'simplefin'` ⇒ entry_line has a link back to a specific `sync_run_id` for audit

Each invariant gets a unit test in `packages/core/**` or an integration test in the Phase 0b+ test suite.
