import type { Db } from '../db/client';
import { auditLog } from '../db/schema';
import { randomId } from '../lib/crypto';

export type AuditEntry = {
  actorUserId?: string | null;
  // "user:<id>", "admin", "github-actions:<repo>"…
  actor: string;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
};

export async function audit(db: Db, entry: AuditEntry) {
  await db
    .insert(auditLog)
    .values({ id: randomId('a_', 16), actorUserId: entry.actorUserId ?? null, ...entry })
    .run();
}
