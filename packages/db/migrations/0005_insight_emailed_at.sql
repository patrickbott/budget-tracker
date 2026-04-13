-- Add emailed_at column to insight table.
-- Nullable: null means the insight was not emailed (email disabled, failed, or predates feature).
ALTER TABLE "insight" ADD COLUMN "emailed_at" timestamp with time zone;
