/**
 * Shared Zod schemas for the core package.
 *
 * Every domain boundary (AI tool inputs, rules JSON, seed data, API
 * surface) should validate against one of these before trusting its input.
 * Keep them framework-agnostic — no React, no Next.js, no DB client.
 */
import { z } from 'zod';

/**
 * A NUMERIC(19,4)-compatible amount string.
 *
 * Matches optional leading minus, 1+ integer digits, and an optional
 * decimal part of 1..4 digits. Rejects scientific notation, thousands
 * separators, and non-ASCII digits. This is the ONE place the shape is
 * defined; every other consumer imports it.
 *
 * Intentionally NOT a number — JavaScript numbers lose precision at
 * ±2^53, which is well inside the finance domain for accounts measured
 * in cents (a $90 trillion liability in cents is only 2^43, so the
 * precision issue is actually the decimal portion, not the magnitude —
 * but we use strings everywhere for consistency and auditability).
 */
export const AmountSchema = z
  .string()
  .regex(
    /^-?\d+(\.\d{1,4})?$/,
    'Amount must match NUMERIC(19,4): optional minus, integer digits, up to 4 decimals',
  );

/** The tenant root id. UUID v4 or v7. */
export const FamilyIdSchema = z.string().uuid();

/** The user id, also a UUID. */
export const UserIdSchema = z.string().uuid();

/**
 * The polymorphic account type enum, kept in lock-step with the
 * `account_type` pgEnum in `packages/db/schema/enums.ts`. When you add a
 * value in the DB, mirror it here.
 */
export const AccountTypeSchema = z.enum([
  'depository',
  'credit_card',
  'investment',
  'loan',
  'property',
  'crypto',
  'other_asset',
  'other_liability',
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

/** Account visibility. `personal` requires `ownerUserId`. */
export const AccountVisibilitySchema = z.enum(['household', 'personal']);
export type AccountVisibility = z.infer<typeof AccountVisibilitySchema>;

/**
 * A single entry line — the minimum information the double-entry
 * validator needs. Consumers that need fuller line shapes (with optional
 * account/category FKs) extend this via `.extend({ ... })`.
 */
export const EntryLineSchema = z.object({
  amount: AmountSchema,
  accountId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  memo: z.string().nullable().optional(),
});
export type EntryLine = z.infer<typeof EntryLineSchema>;

/** An entry + its lines, bundled for validation in one step. */
export const EntryWithLinesSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO date YYYY-MM-DD'),
  description: z.string().min(1),
  lines: z.array(EntryLineSchema).min(2),
});
export type EntryWithLines = z.infer<typeof EntryWithLinesSchema>;
