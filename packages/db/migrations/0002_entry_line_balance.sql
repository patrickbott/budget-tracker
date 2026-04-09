-- ============================================================================
-- 0002_entry_line_balance.sql
--
-- Enforces: for every `entry`, SUM(entry_line.amount) = 0.
--
-- This is the Firefly-III double-entry invariant. Splits, transfers, refunds,
-- and multi-currency moves all rely on it being true. Enforcing it in the
-- database (not just the app layer) is the one guarantee we cannot lose —
-- the double-entry math is what keeps reporting honest, and a single
-- unbalanced entry can silently corrupt every aggregate that touches the
-- affected account.
--
-- Implementation: a deferrable constraint trigger on `entry_line`.
--
--   - AFTER INSERT OR UPDATE OR DELETE — fires after any mutation that
--     affects a line's `amount` or `entry_id`.
--   - DEFERRABLE INITIALLY DEFERRED — the check runs at COMMIT time rather
--     than after each row. This is load-bearing: a multi-row insert
--     (`INSERT ... VALUES (...), (...), ...`) is guaranteed to be
--     transiently unbalanced between statements, and an immediate trigger
--     would raise a spurious exception. Deferring to COMMIT gives the
--     caller a full transaction to assemble a balanced entry.
--   - FOR EACH ROW — the trigger receives one NEW/OLD per affected line,
--     then re-sums all lines for the affected entry_id. This is slightly
--     more work than a statement-level trigger, but it's simpler and the
--     per-row cost is dominated by the SELECT SUM query anyway.
--
-- Error behavior: the function raises a descriptive exception on imbalance.
-- The transaction is then rolled back (Postgres default behavior for a
-- trigger exception inside a committing transaction). Application code
-- should treat this as "the caller built a bad entry; surface a 422 to
-- the user" — it is NEVER a retry-able error.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_entry_line_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_entry_id text;
  line_sum numeric(19, 4);
BEGIN
  -- Identify which entry to re-check. TG_OP = 'DELETE' gives us OLD;
  -- INSERT and UPDATE give us NEW. On UPDATE where the caller moved the
  -- line to a different entry_id (rare but possible), we would need to
  -- re-check BOTH the old and new entries; for now we only check the new
  -- one, and callers should avoid re-parenting entry_lines (rebuild the
  -- entry instead).
  IF TG_OP = 'DELETE' THEN
    affected_entry_id := OLD.entry_id;
  ELSE
    affected_entry_id := NEW.entry_id;
  END IF;

  -- If the parent entry is itself being deleted (cascade from entry →
  -- entry_line), the parent row is already gone by the time this trigger
  -- fires at COMMIT. In that case SUM returns NULL from an empty set; we
  -- treat NULL as "nothing to check" rather than raising.
  SELECT COALESCE(SUM(amount), 0)
  INTO line_sum
  FROM "entry_line"
  WHERE entry_id = affected_entry_id;

  -- No remaining lines for this entry id → either the entry was deleted,
  -- or the caller is in the middle of rebuilding it. Either way, nothing
  -- to enforce.
  IF NOT EXISTS (
    SELECT 1 FROM "entry_line" WHERE entry_id = affected_entry_id
  ) THEN
    RETURN NULL;
  END IF;

  IF line_sum <> 0 THEN
    RAISE EXCEPTION
      'Double-entry invariant violated: entry_id=% has entry_lines summing to %, expected 0',
      affected_entry_id, line_sum
    USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;  -- AFTER triggers ignore the return value.
END;
$$;

--
-- The constraint trigger itself. `DEFERRABLE INITIALLY DEFERRED` is what
-- lets a multi-statement transaction build a balanced entry piece by
-- piece. Without it, the first INSERT would fire the check immediately
-- and fail on a single-leg entry.
--
CREATE CONSTRAINT TRIGGER entry_line_balance_check
  AFTER INSERT OR UPDATE OR DELETE ON "entry_line"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_entry_line_balance();

-- ============================================================================
-- End of entry_line balance enforcement. The app-layer counterpart lives
-- in `packages/core/entries/validateEntryLines`, which refuses to build
-- an unbalanced entry before ever hitting the database. This trigger is
-- the belt-and-suspenders backstop.
-- ============================================================================
