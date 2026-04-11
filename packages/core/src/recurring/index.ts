/**
 * `@budget-tracker/core/recurring` — recurring series detection +
 * `missing_dates` computation.
 *
 * Implements the Lunch-Money-style "repeating merchant + amount + cadence"
 * heuristic: group historical entries by a normalized description prefix,
 * require a tight amount cluster (within 5% of the group median), then
 * classify the series by the spacing between consecutive entries. Confidence
 * is the fraction of gaps that fall inside the inferred cadence bucket.
 */

import Decimal from 'decimal.js';

/** A detected recurring pattern surfaced to the user for confirmation. */
export interface RecurringCandidate {
  descriptionPattern: string;
  expectedAmount: string;
  cadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
  confidence: number;
}

/** Minimal historical-entry shape consumed by the detector. */
export interface RecurringEntryInput {
  entryId: string;
  amount: string;
  entryDate: string;
  description: string;
}

/** Inputs to `computeMissingDates`. */
export interface MissingDatesInput {
  cadence: RecurringCandidate['cadence'];
  cadenceInterval: number;
  startDate: string;
  endDate: string;
  actualDates: readonly string[];
}

// ---------------------------------------------------------------------------
// detectRecurringCandidates
// ---------------------------------------------------------------------------

const CADENCE_BUCKETS: ReadonlyArray<{
  cadence: RecurringCandidate['cadence'];
  minDays: number;
  maxDays: number;
}> = [
  { cadence: 'weekly', minDays: 6, maxDays: 8 },
  { cadence: 'biweekly', minDays: 13, maxDays: 15 },
  { cadence: 'monthly', minDays: 28, maxDays: 32 },
  { cadence: 'quarterly', minDays: 88, maxDays: 93 },
  { cadence: 'semiannual', minDays: 178, maxDays: 186 },
  { cadence: 'yearly', minDays: 360, maxDays: 370 },
];

const AMOUNT_TOLERANCE_PERCENT = new Decimal('0.05');
const MIN_SERIES_SIZE = 3;
const PREFIX_LENGTH = 20;

export function detectRecurringCandidates(
  entries: readonly RecurringEntryInput[],
): RecurringCandidate[] {
  const groups = new Map<string, RecurringEntryInput[]>();
  for (const e of entries) {
    const key = normalizeDescriptionPrefix(e.description);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  interface Draft {
    candidate: RecurringCandidate;
    sampleSize: number;
  }
  const drafts: Draft[] = [];

  for (const [prefix, group] of groups) {
    if (group.length < MIN_SERIES_SIZE) continue;

    const amounts = group.map((e) => new Decimal(e.amount));
    const med = median([...amounts].sort((a, b) => a.cmp(b)));

    const filtered = group.filter((_, i) =>
      withinFivePercent(amounts[i]!, med),
    );
    if (filtered.length < MIN_SERIES_SIZE) continue;

    const sortedByDate = [...filtered].sort((a, b) =>
      a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1 : 0,
    );

    const gaps: number[] = [];
    for (let i = 1; i < sortedByDate.length; i++) {
      gaps.push(
        daysBetween(sortedByDate[i - 1]!.entryDate, sortedByDate[i]!.entryDate),
      );
    }

    const cadenceResult = inferCadence(gaps);
    if (cadenceResult === null) continue;

    drafts.push({
      candidate: {
        descriptionPattern: prefix,
        expectedAmount: med.toFixed(2),
        cadence: cadenceResult.cadence,
        confidence: cadenceResult.confidence,
      },
      sampleSize: sortedByDate.length,
    });
  }

  drafts.sort((a, b) => {
    if (b.candidate.confidence !== a.candidate.confidence) {
      return b.candidate.confidence - a.candidate.confidence;
    }
    return b.sampleSize - a.sampleSize;
  });

  return drafts.map((d) => d.candidate);
}

function normalizeDescriptionPrefix(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PREFIX_LENGTH);
}

function median(sortedAsc: Decimal[]): Decimal {
  const n = sortedAsc.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sortedAsc[mid]!;
  return sortedAsc[mid - 1]!.plus(sortedAsc[mid]!).dividedBy(2);
}

function withinFivePercent(value: Decimal, reference: Decimal): boolean {
  if (reference.isZero()) return value.isZero();
  const diff = value.minus(reference).abs();
  const threshold = reference.abs().times(AMOUNT_TOLERANCE_PERCENT);
  return diff.lessThanOrEqualTo(threshold);
}

function inferCadence(
  gaps: readonly number[],
): { cadence: RecurringCandidate['cadence']; confidence: number } | null {
  if (gaps.length === 0) return null;

  let best: { cadence: RecurringCandidate['cadence']; matches: number } | null =
    null;

  for (const bucket of CADENCE_BUCKETS) {
    const matches = gaps.filter(
      (g) => g >= bucket.minDays && g <= bucket.maxDays,
    ).length;
    if (matches > 0 && (best === null || matches > best.matches)) {
      best = { cadence: bucket.cadence, matches };
    }
  }

  if (best === null) return null;
  return {
    cadence: best.cadence,
    confidence: Math.min(1, best.matches / gaps.length),
  };
}

// ---------------------------------------------------------------------------
// computeMissingDates
// ---------------------------------------------------------------------------

const DAY_MS = 1000 * 60 * 60 * 24;
const TOLERANCE_DAYS = 3;
const MAX_EXPECTED_DATES = 10_000;

export function computeMissingDates(input: MissingDatesInput): string[] {
  const expected = generateExpectedDates(input);
  const actualMs = input.actualDates.map((d) => parseIsoDate(d).getTime());

  const missing: string[] = [];
  for (const iso of expected) {
    const expMs = parseIsoDate(iso).getTime();
    const matched = actualMs.some(
      (a) => Math.abs(a - expMs) <= TOLERANCE_DAYS * DAY_MS,
    );
    if (!matched) missing.push(iso);
  }
  return missing;
}

function generateExpectedDates(
  input: Pick<
    MissingDatesInput,
    'cadence' | 'cadenceInterval' | 'startDate' | 'endDate'
  >,
): string[] {
  const out: string[] = [];
  const end = parseIsoDate(input.endDate);
  const current = parseIsoDate(input.startDate);

  while (current.getTime() <= end.getTime()) {
    if (out.length >= MAX_EXPECTED_DATES) {
      throw new Error(
        `computeMissingDates: expected-date sequence exceeds ${MAX_EXPECTED_DATES} entries ` +
          `for cadence ${input.cadence} (interval ${input.cadenceInterval}) between ` +
          `${input.startDate} and ${input.endDate} — range too large`,
      );
    }
    out.push(formatIsoDate(current));
    advance(current, input.cadence, input.cadenceInterval);
  }
  return out;
}

function advance(
  date: Date,
  cadence: RecurringCandidate['cadence'],
  interval: number,
): void {
  switch (cadence) {
    case 'weekly':
      date.setUTCDate(date.getUTCDate() + 7 * interval);
      return;
    case 'biweekly':
      date.setUTCDate(date.getUTCDate() + 14 * interval);
      return;
    case 'monthly':
      date.setUTCMonth(date.getUTCMonth() + interval);
      return;
    case 'quarterly':
      date.setUTCMonth(date.getUTCMonth() + 3 * interval);
      return;
    case 'semiannual':
      date.setUTCMonth(date.getUTCMonth() + 6 * interval);
      return;
    case 'yearly':
      date.setUTCFullYear(date.getUTCFullYear() + interval);
      return;
  }
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function formatIsoDate(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

function daysBetween(a: string, b: string): number {
  const ms = parseIsoDate(b).getTime() - parseIsoDate(a).getTime();
  return Math.round(ms / DAY_MS);
}
