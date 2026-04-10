-- ============================================================================
-- 0003_entry_external_id.sql
--
-- Dedup columns for packages/jobs/src/ingest/upsert-entries.ts.
-- Per docs/simplefin-notes.md §2, SimpleFIN transaction ids are unique
-- ONLY within a single SimpleFIN account, so the dedup key is
-- (source, external_account_id, external_id), not just (source, external_id).
-- Per §3, SimpleFIN account ids can change on re-linking; we store the
-- current mapping on account.simplefin_account_id (already created in
-- 0000) so the R2 re-link UI can rewrite it without touching the
-- historical entry rows.
--
-- account.simplefin_account_id already exists from migration 0000 with a
-- unique index on (connection_id, simplefin_account_id). This migration
-- adds a family-scoped lookup index for the sync worker's account
-- resolution path.
-- ============================================================================

ALTER TABLE entry
  ADD COLUMN external_id         TEXT,
  ADD COLUMN external_account_id TEXT;

CREATE UNIQUE INDEX entry_external_dedup_idx
  ON entry (source, external_account_id, external_id)
  WHERE external_id IS NOT NULL AND external_account_id IS NOT NULL;

CREATE INDEX account_simplefin_idx
  ON account (family_id, simplefin_account_id)
  WHERE simplefin_account_id IS NOT NULL;
