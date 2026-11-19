import { Injectable } from '@nestjs/common';
import type { Tx } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

/** Append-only audit log (who, when, old → new, reason). Always written in the same transaction as the change. */
@Injectable()
export class AuditService {
  async log(tx: Tx, e: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values({
      actorId: e.actorId,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      oldValue: e.oldValue ?? null,
      newValue: e.newValue ?? null,
      reason: e.reason ?? null,
    });
  }
}
