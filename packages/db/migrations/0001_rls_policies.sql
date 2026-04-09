-- ============================================================================
-- 0001_rls_policies.sql
--
-- Applied after 0000_*.sql. Enforces family-scoped tenancy at the Postgres
-- layer, so that even if the application code has a bug and forgets to
-- filter by family_id, the database still returns zero rows.
--
-- Session variables (set by `withFamilyContext` in packages/db/src/client.ts,
-- via `SELECT set_config(...)` inside a transaction):
--   - `app.current_family_id`  — the active family for this request
--   - `app.current_user_id`    — the active user within that family
--
-- The `current_setting('app.<name>', true)` second argument returns NULL
-- when the variable is unset, rather than raising. Code paths that forget
-- to open a family context will therefore see an empty result set, NOT a
-- Postgres error — this is intentional: failing closed is better than
-- failing loud and letting queries squeak through.
--
-- Sub-tables (depository_account etc.) inherit scope from their parent
-- `account` row via the ON DELETE CASCADE FK. For defense in depth we
-- ALSO enable RLS on each sub-table with a JOIN-back policy, so a direct
-- SELECT against the sub-table from a mis-configured client still gets
-- filtered. The extra JOIN on reads is cheap because sub-tables are
-- always queried with a small N of rows at a time.
--
-- Better Auth tables (`user`, `session`, `auth_account`, `verification`)
-- do NOT have RLS enabled — they are scoped by session cookie, not by
-- family_id, and BA's internal queries do not expect session variables.
-- ============================================================================

--
-- Family-scoped domain tables: enable RLS + family_isolation policy.
--

ALTER TABLE "family" ENABLE ROW LEVEL SECURITY;
-- The family table itself is scoped differently: a user can see a family
-- iff they have a membership row for it. The check happens via the
-- membership RLS policy (below) rather than a direct family_id = ... check,
-- because `family.id` IS the family id.
CREATE POLICY family_self_isolation ON "family"
  USING (id = current_setting('app.current_family_id', true)::text);

ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_family_isolation ON "membership"
  USING (organization_id = current_setting('app.current_family_id', true)::text);

ALTER TABLE "connection" ENABLE ROW LEVEL SECURITY;
CREATE POLICY connection_family_isolation ON "connection"
  USING (family_id = current_setting('app.current_family_id', true)::text);

ALTER TABLE "sync_run" ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_run_family_isolation ON "sync_run"
  USING (family_id = current_setting('app.current_family_id', true)::text);

--
-- Polymorphic financial account: TWO policies on the base `account` table.
--
-- 1. family_isolation — standard family_id scoping.
-- 2. personal_owner_isolation — personal-visibility accounts are visible
--    only to their owner. Household accounts pass through this policy
--    unchanged.
--
-- Both policies apply simultaneously (RLS policies on the same command are
-- ORed by default, but we want AND semantics: a row must be BOTH in the
-- active family AND visible to the current user). We achieve that by
-- expressing both conditions in a single USING clause on one policy.
--
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_family_and_owner_isolation ON "account"
  USING (
    family_id = current_setting('app.current_family_id', true)::text
    AND (
      visibility = 'household'
      OR (
        visibility = 'personal'
        AND owner_user_id = current_setting('app.current_user_id', true)::text
      )
    )
  );

--
-- Sub-tables: JOIN-back policy for defense in depth.
--
-- Rationale: the parent `account` row is already RLS-protected, and the
-- FK from sub-table to parent has ON DELETE CASCADE, so a malicious or
-- bugged query that tries `SELECT * FROM depository_account` will get no
-- rows whose parent account is invisible. But we still want the sub-table
-- lookup itself to refuse cross-family reads, so we add a policy that
-- requires the parent `account` row to be visible.
--
ALTER TABLE "depository_account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY depository_account_parent_isolation ON "depository_account"
  USING (
    EXISTS (
      SELECT 1 FROM "account" a
      WHERE a.id = depository_account.account_id
    )
  );

ALTER TABLE "credit_card_account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_card_account_parent_isolation ON "credit_card_account"
  USING (
    EXISTS (
      SELECT 1 FROM "account" a
      WHERE a.id = credit_card_account.account_id
    )
  );

ALTER TABLE "loan_account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY loan_account_parent_isolation ON "loan_account"
  USING (
    EXISTS (
      SELECT 1 FROM "account" a
      WHERE a.id = loan_account.account_id
    )
  );

ALTER TABLE "investment_account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY investment_account_parent_isolation ON "investment_account"
  USING (
    EXISTS (
      SELECT 1 FROM "account" a
      WHERE a.id = investment_account.account_id
    )
  );

ALTER TABLE "property_account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY property_account_parent_isolation ON "property_account"
  USING (
    EXISTS (
      SELECT 1 FROM "account" a
      WHERE a.id = property_account.account_id
    )
  );

--
-- Core financial events.
--
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;
CREATE POLICY category_family_isolation ON "category"
  USING (family_id = current_setting('app.current_family_id', true)::text);

ALTER TABLE "entry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY entry_family_isolation ON "entry"
  USING (family_id = current_setting('app.current_family_id', true)::text);

--
-- entry_line: does NOT have its own family_id column to keep the row narrow.
-- Instead we JOIN back to the parent `entry` row, which is RLS-protected
-- by family_isolation. This gives entry_line the same isolation guarantee
-- at the cost of one EXISTS check per row; the entry_line_entry_idx index
-- on (entry_id) makes that check cheap.
--
ALTER TABLE "entry_line" ENABLE ROW LEVEL SECURITY;
CREATE POLICY entry_line_parent_isolation ON "entry_line"
  USING (
    EXISTS (
      SELECT 1 FROM "entry" e
      WHERE e.id = entry_line.entry_id
    )
  );

--
-- Domain features: rules, budgets, recurring, goals.
--
ALTER TABLE "rule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY rule_family_isolation ON "rule"
  USING (family_id = current_setting('app.current_family_id', true)::text);

ALTER TABLE "budget" ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_family_isolation ON "budget"
  USING (family_id = current_setting('app.current_family_id', true)::text);

ALTER TABLE "recurring" ENABLE ROW LEVEL SECURITY;
CREATE POLICY recurring_family_isolation ON "recurring"
  USING (family_id = current_setting('app.current_family_id', true)::text);

ALTER TABLE "goal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY goal_family_isolation ON "goal"
  USING (family_id = current_setting('app.current_family_id', true)::text);

--
-- AI feature tables.
--
ALTER TABLE "insight" ENABLE ROW LEVEL SECURITY;
CREATE POLICY insight_family_isolation ON "insight"
  USING (family_id = current_setting('app.current_family_id', true)::text);

ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_family_isolation ON "ai_usage"
  USING (family_id = current_setting('app.current_family_id', true)::text);

--
-- Chat: conversations are per-user within a family. The chat_conversation
-- policy AND-combines the family check with an owner check, mirroring the
-- account personal-visibility pattern.
--
ALTER TABLE "chat_conversation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_conversation_owner_isolation ON "chat_conversation"
  USING (
    family_id = current_setting('app.current_family_id', true)::text
    AND user_id = current_setting('app.current_user_id', true)::text
  );

ALTER TABLE "chat_message" ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_message_family_isolation ON "chat_message"
  USING (family_id = current_setting('app.current_family_id', true)::text);

-- ============================================================================
-- End of RLS policies. See packages/db/src/client.ts for the
-- `withFamilyContext` helper that callers must use to set the session
-- variables these policies depend on.
-- ============================================================================
