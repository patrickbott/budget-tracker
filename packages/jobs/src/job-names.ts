import { z } from 'zod';

export const JOB_NAMES = {
  SYNC_CONNECTION: 'sync-connection',
  SYNC_FAMILY: 'sync-family',
  PRUNE_SYNC_RUNS: 'prune-sync-runs',
} as const;

export const SyncConnectionPayloadSchema = z.object({
  connectionId: z.string().uuid(),
  familyId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type SyncConnectionPayload = z.infer<typeof SyncConnectionPayloadSchema>;
