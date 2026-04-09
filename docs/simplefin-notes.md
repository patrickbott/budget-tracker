# SimpleFIN Notes

> Research-backed quirks and gotchas from integrating with SimpleFIN Bridge. Read this before touching `packages/simplefin/**`. These are load-bearing and easy to forget.

## What SimpleFIN is

**SimpleFIN Bridge** is a thin protocol that sits in front of a bank-data aggregator (currently MX, ~16,000 US institutions). The end user pays SimpleFIN directly (~$15/yr), links banks in SimpleFIN Bridge's own UI, and hands your app a single **Access URL** that your app uses to pull transactions on a cron. Critical property: **your app never sees bank credentials** and there's no SOC2/PII relationship between your app and the user's bank.

- Protocol spec: <https://www.simplefin.org/protocol.html>
- Developer docs: <https://beta-bridge.simplefin.org/info/developers>
- Issues tracker: <https://github.com/simplefin/bridge-issues>

## Setup flow

1. User signs up at `https://beta-bridge.simplefin.org/simplefin/create`, pays, links banks
2. User generates a **Setup Token** in SimpleFIN Bridge — a base64-encoded one-time-use URL
3. User pastes the Setup Token into our app
4. Our app base64-decodes the token → POSTs to the decoded URL → receives an **Access URL** of the form `https://username:password@bridge.simplefin.org/simplefin`
5. Setup Token dies after the exchange. Access URL is long-lived and must be stored encrypted

**Our `/connections/new` UI walks the user through steps 3–4.** Store the encrypted Access URL in `connection.access_url_encrypted`.

## Data endpoint

```
GET {ACCESS_URL}/accounts?version=2&start-date=<unix>&end-date=<unix>&pending=1
```

Returns an `AccountSet` JSON blob with `connections[]`, `accounts[]` (each with nested `transactions[]`), and `errlist[]`.

### Response shape (v2)

```
AccountSet {
  errlist: [{ code, msg, conn_id?, account_id? }],
  connections: [{ conn_id, name, org_id, org_url?, sfin_url }],
  accounts: [Account]
}

Account {
  id: string            // opaque, NOT stable across re-linking
  name: string
  conn_id: string
  currency: string      // ISO 4217 OR URL to custom currency definition
  balance: string       // DECIMAL STRING, not a number
  "available-balance": string?
  "balance-date": int   // unix seconds
  transactions: [Transaction]
  extra: object?        // provider-specific; holdings data lives here when present
}

Transaction {
  id: string            // opaque; unique ONLY within parent account
  posted: int           // unix seconds (when it cleared)
  amount: string        // DECIMAL STRING, negative = debit
  description: string   // OFTEN TRUNCATED to ~32 chars (known issue)
  transacted_at: int?   // actual transaction date (vs posted = clearing date)
  pending: boolean?     // default false
  extra: object?
}
```

## Gotchas — you will hit these

### 1. Amounts are strings, not numbers
**Never** `parseFloat(amount)`. Parse as `Decimal` (via `decimal.js` or equivalent). A single floating-point cent of drift in a finance app destroys user trust.

### 2. Transaction IDs are only unique per account
Dedup key must be `(account_internal_id, simplefin_txn_id)`. Enforce with a unique constraint in Postgres.

### 3. Account IDs change on re-link
If the user disconnects and re-connects an institution, `conn_id` and `account.id` change. Every transaction will look new. Provide a **re-link UI** that lets the user map old `account.id` → new `account.id` so historical data stays attached. Don't use SimpleFIN `account.id` as the primary key; use an internal UUID with `simplefin_account_id` as a nullable reattachable column.

### 4. Pending → posted with a new ID
A pending transaction can reappear as posted with a **different** `id` after clearing. Our dedup logic must:
- First try the exact `(account_id, simplefin_txn_id)` match (normal case)
- On conflict, allow `pending = true → pending = false` transition (no-op otherwise)
- Separately, do a secondary match on `(amount, date ±2 days, description prefix)` for pending-posted with-ID-change — flag as candidate merge

### 5. Descriptions truncated to ~32 chars
This is a known SimpleFIN Bridge bug (`bridge-issues#22`). You get less memo/payee data than the bank actually has. Our rules engine + auto-categorization must work with truncated descriptions.

### 6. Cross-account "mirror" transfers
Some banks (Mercury is notorious) emit the same transfer in both accounts with **different** transaction IDs. Our transfer-detection pass needs to dedupe across accounts, not just within.

### 7. Refunds and splits
- **Refunds** show up as positive-amount transactions on the same account; no `original_transaction_id` link. Handle as normal transactions; the rules engine can tag them.
- **Splits** are not supported in SimpleFIN protocol. Users split in-app; we store as multiple `entry_line` rows on a single entry.

### 8. Foreign currency
- `account.currency` can be an ISO code OR a URL pointing at a custom currency definition (for airline miles, crypto, etc.)
- A single transaction has exactly one amount in the account's currency. If you charge in EUR on a USD card, you see the final USD amount — no `foreign_amount` field, no FX rate
- Multi-currency support (Phase 5): pre-compute `amount_in_family_base_currency` on write using daily FX rates (via `exchangerate.host` or similar free API) so reports don't join at read time

### 9. No categories
SimpleFIN returns zero category information. Categorization is 100% our app's job (rules engine + AI auto-cat).

### 10. Holdings/investments — weak coverage
Investment account balances work. Transaction history is limited (cash movements only). Holdings / positions / lots / cost basis live in the `account.extra` JSON blob, are provider-specific, and **have no first-class schema**. Plan: store the raw `extra` blob in a JSONB column, don't promise holdings reporting from SimpleFIN. Phase 5 adds broker CSV imports to fill this gap.

### 11. No webhooks. Pull only.
- Hit `/accounts` on your own schedule
- SimpleFIN Bridge upstream refreshes from MX **roughly once per 24 hours** at an unpredictable time. More frequent pulls waste our quota and return nothing fresher
- We pull once per day, per family, at a randomized hour (4–6am family-local). `SIMPLEFIN_PULLS_PER_DAY` env var defaults to 1

### 12. Rate limits
- **24 requests per day** on the `/accounts` bulk endpoint
- **90-day date range max** per request. For longer windows, paginate in 90-day chunks
- Exceeding limits produces warnings in `errlist`, then disables the token
- Track our quota used per connection; back off conservatively; alert the user if a token gets disabled

### 13. Initial history ≤ 90 days
First sync only returns up to 90 days of history (often less). **You cannot backfill years of history through SimpleFIN.** Users who want deep history should import OFX/CSV once and then use SimpleFIN for forward-going sync. Phase 5 adds CSV/OFX import.

### 14. Some banks don't report currency
Chime and a few neobanks omit the `currency` field (`bridge-issues#16`). Default to the family's base currency with a warning.

### 15. `errlist` entries need UI surfacing
Per-connection error messages like "Bank requires re-authentication" come through `errlist` with a `conn_id`. Surface these as a per-connection badge/banner in the UI so users can re-link without us having to guess. Don't ignore `errlist` — SimpleFIN explicitly asks apps to surface these to users.

## Best-practice sync loop (what our `packages/jobs/sync` does)

```
For each active connection (one per family):
  1. Compute the pull window:
     start = max(balance_date across this connection's accounts) - 7 days
     end   = now
  2. If start..end spans > 90 days, split into 90-day chunks (first sync only)
  3. Fetch GET {access_url}/accounts?version=2&start-date=...&end-date=...&pending=1
  4. Log gzipped raw response to sync_run for 7 days
  5. Process errlist[]: update connection.status, surface in UI
  6. For each account in response:
     - Reconcile balances (balance_as_of = balance-date)
     - Upsert each transaction via (account_id, simplefin_txn_id) dedup
     - On conflict, allow pending→posted transition; otherwise no-op
     - Secondary match for pending→posted with ID change
  7. Run transfer-detection pass on newly-created entries
  8. Run recurring-detection pass on newly-created entries
  9. Run auto-categorization pass (rules engine → Haiku for unmatched)
  10. Update connection.last_synced_at
  11. Ping Healthchecks.io if configured
```

## Reference implementations worth reading

- **Actual Budget** `actualbudget/actual-server` — the canonical production SimpleFIN integration. Especially PR #315 (pending support) and issue #2272 (long feedback/gotcha thread)
- **`duplaja/actual-simplefin-sync`** — minimal sync script, good reference
- **`avirut/bursar`** — SimpleFIN → Google Sheets, very minimal

## Pricing / cost to user

- **$1.50/month or $15/year**, paid by the end user directly to SimpleFIN Bridge
- App developer pays zero
- No free tier (as of 2026)

## Alternatives (sanity checked during research, not chosen)

- **Plaid** — ruled out by user upfront (trust/cost/setup burden)
- **GoCardless Bank Account Data (ex-Nordigen)** — EU/UK only and stopped onboarding new customers in Sept 2025. Not viable
- **Teller.io** — US-focused, better API, real webhooks, free dev tier, but the end user trusts *you* with the bank relationship rather than a neutral third party. Worse legal/trust story for a self-hosted personal app
- **Finicity / MX direct / Akoya** — enterprise, KYB required. Not viable for personal self-hosted
- **DIY OFX scraping** — fragile, most banks have killed Direct Connect. Not worth planning around

**SimpleFIN is still the right call for a self-hosted US personal finance app in 2026.**
