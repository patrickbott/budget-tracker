/**
 * Red-team suite for the PII stripper. Each category has at least one
 * positive ("strip it") test and one near-miss ("don't strip legitimate
 * non-PII data"). The stripper is the AI tool boundary's single line of
 * defence, so negative tests are as important as positive ones — over-
 * stripping mangles amounts and IDs, under-stripping leaks PII.
 */

import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { stripPII } from './pii-stripper.ts';

describe('stripPII — emails', () => {
  it('strips a plain email', () => {
    expect(stripPII('Contact alice@example.com today')).toBe(
      'Contact [email] today',
    );
  });

  it('strips emails with dots, pluses, and subdomains', () => {
    expect(stripPII('note: first.last+tag@mail.example.co.uk')).toBe(
      'note: [email]',
    );
  });

  it('leaves raw local-parts without a domain alone', () => {
    expect(stripPII('Welcome back username-only!')).toBe(
      'Welcome back username-only!',
    );
  });

  it('leaves @mentions without a domain alone', () => {
    expect(stripPII('cc @patrick on this')).toBe('cc @patrick on this');
  });
});

describe('stripPII — phone numbers', () => {
  it('strips a US dashed phone number', () => {
    expect(stripPII('Call 555-123-4567 for support')).toBe(
      'Call [phone] for support',
    );
  });

  it('strips a phone with parens and spaces', () => {
    expect(stripPII('Support: (555) 123-4567')).toBe('Support: [phone]');
  });

  it('strips a phone with dot separators', () => {
    expect(stripPII('Hotline 555.123.4567 24/7')).toBe(
      'Hotline [phone] 24/7',
    );
  });

  it('strips a ten-digit no-separator phone (labeled as account, PII still gone)', () => {
    const out = stripPII('Ring 5551234567 now');
    expect(out).not.toContain('5551234567');
  });

  it('leaves short numeric tokens alone', () => {
    expect(stripPII('card ending in 1234')).toBe('card ending in 1234');
  });

  it('leaves year tokens alone', () => {
    expect(stripPII('fiscal year 2026 projections')).toBe(
      'fiscal year 2026 projections',
    );
  });
});

describe('stripPII — SSN-shaped strings', () => {
  it('strips a dashed SSN', () => {
    expect(stripPII('SSN 123-45-6789 on file')).toBe('SSN [ssn] on file');
  });

  it('strips an SSN at end of string', () => {
    expect(stripPII('Taxpayer id: 987-65-4321')).toBe(
      'Taxpayer id: [ssn]',
    );
  });

  it('leaves a dashed phone alone (different shape)', () => {
    // 3-3-4, not 3-2-4; falls through to the phone matcher instead.
    expect(stripPII('Try 555-123-4567')).toBe('Try [phone]');
  });

  it('leaves a short dashed ID alone', () => {
    expect(stripPII('Ref 12-34-56')).toBe('Ref 12-34-56');
  });
});

describe('stripPII — routing numbers', () => {
  it('strips a Federal Reserve routing number (021000021 is NY Fed)', () => {
    expect(stripPII('Routing 021000021 for ACH')).toBe(
      'Routing [routing] for ACH',
    );
  });

  it('strips a thrift-band routing number', () => {
    expect(stripPII('ABA 213000000 (thrift)')).toBe(
      'ABA [routing] (thrift)',
    );
  });

  it('leaves a 9-digit number with an invalid routing prefix alone-ish', () => {
    // Starts with `9`, not a valid Fed prefix; falls through to account.
    const out = stripPII('Acct 987654321 long');
    expect(out).not.toContain('987654321');
    expect(out).toContain('[account]');
  });

  it('leaves a short numeric ID alone', () => {
    expect(stripPII('Txn 12345 posted')).toBe('Txn 12345 posted');
  });
});

describe('stripPII — 6+ digit account numbers', () => {
  it('strips a bare 9-digit account run', () => {
    expect(stripPII('From account 555443322 settled')).toBe(
      'From account [account] settled',
    );
  });

  it('strips a 6-digit run', () => {
    expect(stripPII('PIN fragment 112233')).toBe('PIN fragment [account]');
  });

  it('strips a 12-digit run', () => {
    expect(stripPII('Card 555566667777')).toBe('Card [account]');
  });

  it('leaves ISO-shaped dates alone', () => {
    expect(stripPII('settled on 2026-04-11 at noon')).toBe(
      'settled on 2026-04-11 at noon',
    );
  });

  it('leaves embedded-in-word alphanumeric IDs alone', () => {
    // No leading word boundary before the digits, so the rule sees no match.
    expect(stripPII('category cat_abc123456 linked')).toBe(
      'category cat_abc123456 linked',
    );
  });

  it('leaves comma-grouped amounts alone', () => {
    expect(stripPII('Total $1,234,567 outstanding')).toBe(
      'Total $1,234,567 outstanding',
    );
  });

  it('preserves decimal-formatted six-figure amounts', () => {
    // This is the critical regression test: net worth of $123,456 is stored
    // as "123456.00" by `Decimal.toFixed(2)` in core reports, and MUST
    // survive the stripper or every six-figure family's dashboards break.
    expect(stripPII('net: 123456.00')).toBe('net: 123456.00');
  });

  it('preserves a seven-figure decimal amount', () => {
    expect(stripPII('asset: 2500000.00')).toBe('asset: 2500000.00');
  });
});

describe('stripPII — best-effort human names', () => {
  it('strips a "Customer:" prefixed name', () => {
    expect(stripPII('Customer: Jane Doe')).toBe('Customer: [name]');
  });

  it('strips a "Name " prefixed pair', () => {
    expect(stripPII('Name John Smith applies')).toBe(
      'Name [name] applies',
    );
  });

  it('strips a "cardholder:" prefixed name', () => {
    expect(stripPII('cardholder: Robert Brown')).toBe(
      'cardholder: [name]',
    );
  });

  it('leaves title-case merchant names alone', () => {
    expect(stripPII('Whole Foods Market purchase')).toBe(
      'Whole Foods Market purchase',
    );
  });

  it('leaves city names alone', () => {
    expect(stripPII('Trip to New York last week')).toBe(
      'Trip to New York last week',
    );
  });

  it('leaves a title-case payee without a keyword alone', () => {
    expect(stripPII('Starbucks Coffee on 5th')).toBe(
      'Starbucks Coffee on 5th',
    );
  });
});

describe('stripPII — deep walking', () => {
  it('recurses into nested objects', () => {
    const input = {
      description: 'Contact jane@example.com',
      meta: { notes: 'Call 555-123-4567 anytime' },
    };
    const out = stripPII(input);
    expect(out.description).toBe('Contact [email]');
    expect(out.meta.notes).toBe('Call [phone] anytime');
  });

  it('recurses into arrays', () => {
    const input = [
      'alice@example.com',
      { text: 'SSN 123-45-6789' },
      'plain string',
    ];
    const out = stripPII(input);
    expect(out[0]).toBe('[email]');
    expect((out[1] as { text: string }).text).toBe('SSN [ssn]');
    expect(out[2]).toBe('plain string');
  });

  it('returns a new object rather than mutating the input', () => {
    const input = { email: 'bob@example.com' };
    const out = stripPII(input);
    expect(input.email).toBe('bob@example.com');
    expect(out.email).toBe('[email]');
    expect(out).not.toBe(input);
  });

  it('passes numbers, booleans, null, and undefined through unchanged', () => {
    expect(stripPII(42)).toBe(42);
    expect(stripPII(true)).toBe(true);
    expect(stripPII(null)).toBe(null);
    expect(stripPII(undefined)).toBe(undefined);
  });

  it('passes Decimal instances through by identity', () => {
    const amount = new Decimal('123456.78');
    const out = stripPII({ total: amount });
    expect(out.total).toBe(amount);
    expect(out.total.toFixed(2)).toBe('123456.78');
  });

  it('passes Date instances through by identity', () => {
    const date = new Date('2026-04-11T00:00:00.000Z');
    const out = stripPII({ when: date });
    expect(out.when).toBe(date);
  });

  it('passes Map instances through by identity', () => {
    const map = new Map<string, string>([['alice@example.com', 'skip']]);
    const out = stripPII({ lookup: map });
    expect(out.lookup).toBe(map);
    expect(out.lookup.get('alice@example.com')).toBe('skip');
  });

  it('handles a realistic tool-output shape end-to-end', () => {
    const payload = {
      window: { start: '2026-01-01', end: '2026-04-01' },
      rows: [
        {
          categoryName: 'Groceries',
          total: '123456.00',
          note: 'includes Customer: Jane Doe at Whole Foods',
        },
      ],
      contactEmail: 'owner@example.com',
    };
    const out = stripPII(payload);
    expect(out.window.start).toBe('2026-01-01');
    expect(out.rows[0]!.categoryName).toBe('Groceries');
    expect(out.rows[0]!.total).toBe('123456.00');
    expect(out.rows[0]!.note).toBe(
      'includes Customer: [name] at Whole Foods',
    );
    expect(out.contactEmail).toBe('[email]');
  });
});
