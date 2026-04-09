/**
 * Dev seed script — `pnpm --filter @budget-tracker/db run db:seed`.
 *
 * Populates a local Postgres instance with a tiny but realistic fixture set:
 *
 *   • 1 family (Bott Household)
 *   • 2 users (owner + member) + 2 membership rows
 *   • 3 financial accounts (checking, savings, credit card) + the matching
 *     sub-table rows for each
 *   • 5 categories (Groceries, Dining, Rent, Gas, Salary)
 *   • ~10 entries spanning the last 14 days, each with a balanced pair of
 *     entry_lines
 *
 * Idempotency: every row uses a fixed UUID, and the inserts are wrapped in
 * `ON CONFLICT DO NOTHING`. Running the seed twice produces the same
 * database state as running it once — handy for dev loop ergonomics.
 *
 * Safety: the seed opens its own postgres-js connection (not through
 * `withFamilyContext`) because RLS is enabled on every domain table, and
 * the seed predates any session. To bypass RLS we ALSO run `SET LOCAL
 * row_security = off` at the start of the transaction. This is only safe
 * in a dev environment where nobody else is connected — NEVER run this
 * against a production database.
 *
 * Invariant check: each entry's lines are summed (via decimal.js) before
 * insert, and the seed refuses to write an unbalanced entry. The
 * 0002_entry_line_balance.sql trigger is still the backstop.
 */
import process from 'node:process';

import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';

import { createDb } from './client.ts';
import * as schema from './schema/index.ts';

// --- Fixed UUIDs (so re-runs are deterministic) -----------------------------

const IDS = {
  family: '00000000-0000-4000-8000-000000000001',
  userOwner: '00000000-0000-4000-8000-000000000010',
  userMember: '00000000-0000-4000-8000-000000000011',
  membershipOwner: '00000000-0000-4000-8000-000000000020',
  membershipMember: '00000000-0000-4000-8000-000000000021',
  accountChecking: '00000000-0000-4000-8000-000000000030',
  accountSavings: '00000000-0000-4000-8000-000000000031',
  accountCreditCard: '00000000-0000-4000-8000-000000000032',
  categoryGroceries: '00000000-0000-4000-8000-000000000040',
  categoryDining: '00000000-0000-4000-8000-000000000041',
  categoryRent: '00000000-0000-4000-8000-000000000042',
  categoryGas: '00000000-0000-4000-8000-000000000043',
  categorySalary: '00000000-0000-4000-8000-000000000044',
} as const;

// --- Helpers ----------------------------------------------------------------

/**
 * Build a pair of entry_lines for a standard single-account transaction.
 * The signed amount is the "money leaving the asset" leg (negative for a
 * spend, positive for income); the category leg gets the opposite sign so
 * the pair sums to zero.
 */
function makeLines(options: {
  entryId: string;
  accountId: string;
  categoryId: string | null;
  amount: string;
}): schema.NewEntryLine[] {
  const assetAmount = new Decimal(options.amount);
  const categoryAmount = assetAmount.negated();

  // Pre-insert invariant check.
  const total = assetAmount.plus(categoryAmount);
  if (!total.eq(0)) {
    throw new Error(
      `Seed bug: entry ${options.entryId} has unbalanced lines (sum=${total.toFixed(4)})`,
    );
  }

  return [
    {
      id: `${options.entryId}-a`,
      entryId: options.entryId,
      accountId: options.accountId,
      categoryId: null,
      amount: assetAmount.toFixed(4),
      memo: null,
    },
    {
      id: `${options.entryId}-b`,
      entryId: options.entryId,
      accountId: null,
      categoryId: options.categoryId,
      amount: categoryAmount.toFixed(4),
      memo: null,
    },
  ];
}

/** Offset a base date by N days. */
function daysAgo(base: Date, n: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// --- Main -------------------------------------------------------------------

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      'DATABASE_URL is required. Set it to your dev Postgres connection string.',
    );
    console.error(
      'Example: DATABASE_URL=postgres://budget:budget@localhost:5432/budget_tracker',
    );
    process.exit(1);
  }

  console.log('Seeding Budget Tracker dev data...');
  const { db, sql: client } = createDb(databaseUrl);

  try {
    await db.transaction(async (tx) => {
      // Disable RLS for the seed transaction — we have no family context
      // yet and we own the database in dev.
      await tx.execute(sql`SET LOCAL row_security = off`);

      // --- Users ---------------------------------------------------------
      await tx
        .insert(schema.user)
        .values([
          {
            id: IDS.userOwner,
            name: 'Patrick Bott',
            email: 'patrick@example.invalid',
            emailVerified: true,
          },
          {
            id: IDS.userMember,
            name: 'Jane Bott',
            email: 'jane@example.invalid',
            emailVerified: true,
          },
        ])
        .onConflictDoNothing();

      // --- Family --------------------------------------------------------
      await tx
        .insert(schema.family)
        .values({
          id: IDS.family,
          name: 'Bott Household',
          slug: 'bott-household',
          baseCurrency: 'USD',
          timezone: 'America/New_York',
        })
        .onConflictDoNothing();

      // --- Memberships ---------------------------------------------------
      await tx
        .insert(schema.membership)
        .values([
          {
            id: IDS.membershipOwner,
            userId: IDS.userOwner,
            organizationId: IDS.family,
            role: 'owner',
          },
          {
            id: IDS.membershipMember,
            userId: IDS.userMember,
            organizationId: IDS.family,
            role: 'member',
          },
        ])
        .onConflictDoNothing();

      // --- Accounts ------------------------------------------------------
      await tx
        .insert(schema.account)
        .values([
          {
            id: IDS.accountChecking,
            familyId: IDS.family,
            name: 'Primary Checking',
            accountType: 'depository',
            currency: 'USD',
            visibility: 'household',
            balance: '3450.1200',
            isManual: false,
          },
          {
            id: IDS.accountSavings,
            familyId: IDS.family,
            name: 'Emergency Savings',
            accountType: 'depository',
            currency: 'USD',
            visibility: 'household',
            balance: '12500.0000',
            isManual: false,
          },
          {
            id: IDS.accountCreditCard,
            familyId: IDS.family,
            name: 'Travel Rewards Card',
            accountType: 'credit_card',
            currency: 'USD',
            visibility: 'household',
            balance: '-842.5600',
            isManual: false,
          },
        ])
        .onConflictDoNothing();

      // Sub-tables for each account type.
      await tx
        .insert(schema.depositoryAccount)
        .values([
          {
            accountId: IDS.accountChecking,
            subtype: 'checking',
            institutionName: 'Example Bank',
            accountNumberLast4: '1234',
          },
          {
            accountId: IDS.accountSavings,
            subtype: 'savings',
            institutionName: 'Example Bank',
            accountNumberLast4: '5678',
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(schema.creditCardAccount)
        .values({
          accountId: IDS.accountCreditCard,
          institutionName: 'Example Issuer',
          creditLimit: '10000.0000',
          apr: '0.1999',
          statementDay: 15,
          cardNumberLast4: '9012',
        })
        .onConflictDoNothing();

      // --- Categories ----------------------------------------------------
      await tx
        .insert(schema.category)
        .values([
          {
            id: IDS.categoryGroceries,
            familyId: IDS.family,
            name: 'Groceries',
            kind: 'expense',
            color: '#10b981',
            icon: 'shopping-cart',
            sortOrder: 10,
          },
          {
            id: IDS.categoryDining,
            familyId: IDS.family,
            name: 'Dining',
            kind: 'expense',
            color: '#f59e0b',
            icon: 'utensils',
            sortOrder: 20,
          },
          {
            id: IDS.categoryRent,
            familyId: IDS.family,
            name: 'Rent',
            kind: 'expense',
            color: '#ef4444',
            icon: 'home',
            sortOrder: 30,
          },
          {
            id: IDS.categoryGas,
            familyId: IDS.family,
            name: 'Gas',
            kind: 'expense',
            color: '#6366f1',
            icon: 'fuel',
            sortOrder: 40,
          },
          {
            id: IDS.categorySalary,
            familyId: IDS.family,
            name: 'Salary',
            kind: 'income',
            color: '#22c55e',
            icon: 'briefcase',
            sortOrder: 50,
          },
        ])
        .onConflictDoNothing();

      // --- Entries + entry_lines ----------------------------------------
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      type SeedEntry = {
        id: string;
        entryDate: Date;
        description: string;
        accountId: string;
        categoryId: string;
        amount: string; // signed: negative=spend, positive=income
      };

      const seedEntries: SeedEntry[] = [
        {
          id: '00000000-0000-4000-8000-000000000101',
          entryDate: daysAgo(today, 1),
          description: 'Whole Foods Market',
          accountId: IDS.accountChecking,
          categoryId: IDS.categoryGroceries,
          amount: '-82.4300',
        },
        {
          id: '00000000-0000-4000-8000-000000000102',
          entryDate: daysAgo(today, 2),
          description: 'Shell Gas Station',
          accountId: IDS.accountCreditCard,
          categoryId: IDS.categoryGas,
          amount: '-47.1800',
        },
        {
          id: '00000000-0000-4000-8000-000000000103',
          entryDate: daysAgo(today, 3),
          description: 'Tony Ramen',
          accountId: IDS.accountCreditCard,
          categoryId: IDS.categoryDining,
          amount: '-38.5000',
        },
        {
          id: '00000000-0000-4000-8000-000000000104',
          entryDate: daysAgo(today, 4),
          description: 'Trader Joe\'s',
          accountId: IDS.accountChecking,
          categoryId: IDS.categoryGroceries,
          amount: '-51.2000',
        },
        {
          id: '00000000-0000-4000-8000-000000000105',
          entryDate: daysAgo(today, 5),
          description: 'Salary — Acme Corp',
          accountId: IDS.accountChecking,
          categoryId: IDS.categorySalary,
          amount: '3200.0000',
        },
        {
          id: '00000000-0000-4000-8000-000000000106',
          entryDate: daysAgo(today, 6),
          description: 'Chevron',
          accountId: IDS.accountCreditCard,
          categoryId: IDS.categoryGas,
          amount: '-43.7500',
        },
        {
          id: '00000000-0000-4000-8000-000000000107',
          entryDate: daysAgo(today, 8),
          description: 'Pho Real',
          accountId: IDS.accountCreditCard,
          categoryId: IDS.categoryDining,
          amount: '-28.0000',
        },
        {
          id: '00000000-0000-4000-8000-000000000108',
          entryDate: daysAgo(today, 10),
          description: 'Safeway',
          accountId: IDS.accountChecking,
          categoryId: IDS.categoryGroceries,
          amount: '-64.8800',
        },
        {
          id: '00000000-0000-4000-8000-000000000109',
          entryDate: daysAgo(today, 12),
          description: 'Rent — April 2026',
          accountId: IDS.accountChecking,
          categoryId: IDS.categoryRent,
          amount: '-1850.0000',
        },
        {
          id: '00000000-0000-4000-8000-000000000110',
          entryDate: daysAgo(today, 13),
          description: 'Sushi Zen',
          accountId: IDS.accountCreditCard,
          categoryId: IDS.categoryDining,
          amount: '-62.4000',
        },
      ];

      for (const e of seedEntries) {
        await tx
          .insert(schema.entry)
          .values({
            id: e.id,
            familyId: IDS.family,
            entryDate: e.entryDate,
            entryableType: 'transaction',
            description: e.description,
            source: 'manual',
          })
          .onConflictDoNothing();

        await tx
          .insert(schema.entryLine)
          .values(
            makeLines({
              entryId: e.id,
              accountId: e.accountId,
              categoryId: e.categoryId,
              amount: e.amount,
            }),
          )
          .onConflictDoNothing();
      }

      console.log(
        `Seeded: 1 family, 2 users, 2 memberships, 3 accounts, 5 categories, ${seedEntries.length} entries (each balanced ✓).`,
      );
    });
  } finally {
    await client.end({ timeout: 5 });
  }

  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
