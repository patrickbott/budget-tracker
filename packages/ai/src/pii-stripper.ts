/**
 * `stripPII` — deep-walk any tool-adapter return value and scrub
 * personally-identifying strings before the payload leaves the process.
 *
 * The stripper is load-bearing for the AI tool boundary: every adapter
 * pipes its output through `stripPII` regardless of whether the raw
 * data "looks clean," because the surface area of what tools return
 * will grow as R3/R4 land richer tools and we want a single chokepoint
 * the model can never bypass.
 *
 * Categories (see `docs/ai-tools.md` §"PII stripping"):
 *   - emails                        → `[email]`
 *   - SSN-shaped                    → `[ssn]`
 *   - 9-digit US routing numbers    → `[routing]`
 *   - 6+ contiguous digit runs      → `[account]` (catches raw account
 *     numbers and any other long-digit leakage such as ATM PAN fragments)
 *   - phone numbers                 → `[phone]` (various formats)
 *   - keyword-prefixed human names  → `[name]`   (best-effort)
 *
 * Near-misses we deliberately do NOT strip: ISO dates (`2026-04-11`
 * splits into short runs the boundary rule ignores), UUIDs (hex chunks
 * interleaved with non-digits), category/account IDs like `cat_abc`,
 * city-style title-case phrases not preceded by a keyword.
 */

/** Emails with a required dot-TLD — avoids false positives on things
 *  like `user@host` lacking a domain suffix. */
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;

/** US-shaped SSN. Strict dash form — keeps us clear of 9-digit runs
 *  that happen to sit inside a longer identifier. */
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * 9-digit US routing numbers. The first two digits identify the
 * Federal Reserve district / special-purpose band:
 *   01–12 FRB regular, 21–32 thrift routing, 61–72 electronic/EFT,
 *   80    traveler's checks / special institutions.
 * We run routing BEFORE the generic 6+ digit account rule so a valid
 * hit is labeled `[routing]` instead of `[account]`.
 */
const ROUTING_RE =
  /\b(?:0[1-9]|1[0-2]|2[1-9]|3[0-2]|6[1-9]|7[0-2]|80)\d{7}\b/g;

/** Phone numbers: optional `+CC`, 3 digits (maybe in parens), 3 digits,
 *  4 digits, with space/dot/dash separators that are all optional so a
 *  run-together `5551234567` still matches. */
const PHONE_RE =
  /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

/** Any run of 6+ contiguous digits bounded by word boundaries. ISO
 *  dates (`2026-04-11`) split into 4- and 2-digit runs, safe. UUIDs and
 *  `cat_abc123` don't hit a leading word boundary, safe.
 *
 *  The `(?!\.\d)` negative lookahead preserves decimal-formatted amounts
 *  like `"123456.00"` (from `Decimal.toFixed(2)` in core reports) — any
 *  6+ digit run directly followed by `.<digit>` is a decimal integer
 *  part, not a leaking account number. Without this, a family's
 *  six-figure net worth would be mangled into `"[account].00"`. */
const ACCOUNT_RE = /\b\d{6,}\b(?!\.\d)/g;

/** Keyword-prefixed two-word title-case. Narrow on purpose: "Whole Foods"
 *  without a keyword prefix stays put, "Customer: Jane Doe" gets cleaned.
 *  Best-effort is the explicit contract in `docs/ai-tools.md`. */
const NAME_RE =
  /\b(?:name|contact|customer|payee|payer|owner|account holder|cardholder)[:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)\b/gi;

function stripString(s: string): string {
  return s
    .replace(EMAIL_RE, '[email]')
    .replace(SSN_RE, '[ssn]')
    .replace(ROUTING_RE, '[routing]')
    .replace(ACCOUNT_RE, '[account]')
    .replace(PHONE_RE, '[phone]')
    .replace(NAME_RE, (match, name: string) => match.replace(name, '[name]'));
}

/**
 * Deep-walk `value`, returning a new copy with every string run through
 * `stripString`. Arrays recurse element-wise; plain objects recurse
 * value-wise; class instances (Date, Decimal, Map, Set, RegExp, Error,
 * …) and all non-object primitives pass through by identity. Matching
 * on `Object.prototype` keeps us from poking at library objects with
 * hidden state or methods the walker would corrupt.
 */
export function stripPII<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === 'string') return stripString(value);
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(walk);

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = walk(v);
  }
  return out;
}
