import { z } from 'zod';

/** A single item from the top-level `errlist` array. */
export const ErrListItemSchema = z
  .object({
    code: z.string(),
    msg: z.string(),
    conn_id: z.string().optional(),
    account_id: z.string().optional(),
  })
  .passthrough();

export type RawErrListItem = z.infer<typeof ErrListItemSchema>;

/** A single transaction within an account. */
export const RawTransactionSchema = z.object({
  id: z.string(),
  /** Unix seconds (when it cleared). */
  posted: z.number().int().nonnegative(),
  /** Decimal string — NEVER a number. */
  amount: z.string(),
  /** Often truncated to ~32 chars by SimpleFIN Bridge. */
  description: z.string(),
  /** Unix seconds — actual transaction date vs clearing date. */
  transacted_at: z.number().int().nonnegative().optional(),
  /** Defaults to false when absent. */
  pending: z.boolean().optional().default(false),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type RawTransaction = z.infer<typeof RawTransactionSchema>;

/** A single account within the response. */
export const RawAccountSchema = z.object({
  /** Opaque, NOT stable across re-linking. */
  id: z.string(),
  name: z.string(),
  conn_id: z.string(),
  /** ISO 4217 code OR a URL to a custom currency definition. */
  currency: z.string(),
  /** Decimal string — NEVER a number. */
  balance: z.string(),
  /** Decimal string, optional. */
  'available-balance': z.string().optional(),
  /** Unix seconds. */
  'balance-date': z.number().int().nonnegative(),
  transactions: z.array(RawTransactionSchema),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type RawAccount = z.infer<typeof RawAccountSchema>;

/** A single connection entry. */
export const RawConnectionSchema = z.object({
  conn_id: z.string(),
  name: z.string(),
  org_id: z.string(),
  org_url: z.string().optional(),
  sfin_url: z.string(),
});

export type RawConnection = z.infer<typeof RawConnectionSchema>;

/** Top-level `/accounts?version=2` response. */
export const AccountSetResponseSchema = z.object({
  errlist: z.array(ErrListItemSchema).default([]),
  connections: z.array(RawConnectionSchema).default([]),
  accounts: z.array(RawAccountSchema),
});

export type RawAccountSetResponse = z.infer<typeof AccountSetResponseSchema>;
