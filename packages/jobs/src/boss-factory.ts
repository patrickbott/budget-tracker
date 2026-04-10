import PgBoss from 'pg-boss';

/**
 * Create a pg-boss instance.
 *
 * Uses the `pgboss` schema so pg-boss tables live outside `public` and can
 * be dropped/recreated independently without touching application tables.
 */
export function createBoss(databaseUrl: string): PgBoss {
  return new PgBoss({
    connectionString: databaseUrl,
    schema: 'pgboss',
  });
}
