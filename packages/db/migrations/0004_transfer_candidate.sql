-- ============================================================================
-- 0004_transfer_candidate.sql
--
-- Adds the `transfer_candidate` table used by the post-sync transfer
-- detection pass in `packages/jobs/src/ingest/detect-transfers.ts`. The
-- detector calls `@budget-tracker/core/transfers`'s pure heuristic and
-- persists each flagged pair here with `status = 'pending'` until the user
-- confirms or dismisses from the transactions UI.
--
-- On confirm (`confirmTransferCandidate` server action) both referenced
-- entries have their `entryable_type` flipped to `'transfer'` and the
-- candidate row is marked `confirmed`. On dismiss the candidate row is
-- marked `dismissed` and the two entries are left untouched. We
-- deliberately preserve the two original entry rows on confirmation rather
-- than collapsing them into a single synthetic parent — that keeps the
-- audit trail intact and makes dismiss-after-confirm a pure status flip.
--
-- The `(entry_a_id, entry_b_id)` unique index keeps repeated sync runs
-- idempotent: the detector reinserts with `ON CONFLICT DO NOTHING` so
-- rescanning a window never duplicates a pair we already know about.
--
-- RLS: same family_isolation pattern as the other domain tables defined in
-- `0001_rls_policies.sql`.
-- ============================================================================

CREATE TYPE "public"."transfer_candidate_status" AS ENUM('pending', 'confirmed', 'dismissed');

CREATE TABLE "transfer_candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"entry_a_id" text NOT NULL,
	"entry_b_id" text NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"status" "transfer_candidate_status" DEFAULT 'pending' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);

ALTER TABLE "transfer_candidate"
	ADD CONSTRAINT "transfer_candidate_family_id_family_id_fk"
	FOREIGN KEY ("family_id") REFERENCES "public"."family"("id")
	ON DELETE cascade ON UPDATE no action;

ALTER TABLE "transfer_candidate"
	ADD CONSTRAINT "transfer_candidate_entry_a_id_entry_id_fk"
	FOREIGN KEY ("entry_a_id") REFERENCES "public"."entry"("id")
	ON DELETE cascade ON UPDATE no action;

ALTER TABLE "transfer_candidate"
	ADD CONSTRAINT "transfer_candidate_entry_b_id_entry_id_fk"
	FOREIGN KEY ("entry_b_id") REFERENCES "public"."entry"("id")
	ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "transfer_candidate_pair_idx"
	ON "transfer_candidate" USING btree ("entry_a_id","entry_b_id");

CREATE INDEX "transfer_candidate_family_status_idx"
	ON "transfer_candidate" USING btree ("family_id","status");

--
-- Row-level security: mirrors the family_isolation pattern used by every
-- other domain table in 0001_rls_policies.sql. See that file for the
-- rationale behind reading `current_setting('app.current_family_id', true)`
-- with the two-argument form that returns NULL on missing rather than
-- raising — failing closed is safer than failing loud here.
--
ALTER TABLE "transfer_candidate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY transfer_candidate_family_isolation ON "transfer_candidate"
	USING (family_id = current_setting('app.current_family_id', true)::text);
