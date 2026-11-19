/**
 * BC transfer queue (ARCHITEKTUR 5.3, ENTSCHEIDUNGEN E-09). Runs in the worker (DB role monteur_worker).
 *
 *  - Claims due PENDING transfers with FOR UPDATE SKIP LOCKED (several workers possible).
 *  - Within a group (e.g. one service order, one allocation) transfers run strictly in creation order;
 *    a FAILED/DEAD transfer blocks its group until an admin resends or resolves it.
 *  - Idempotent: creates carry monteurAppId = transfer id, so a replay after a crash returns the existing BC record.
 *  - Retry with exponential backoff (30 s · 2^n, max 1 h, jitter) on 429/5xx/network; DEAD after 10 attempts.
 *  - Business errors (4xx) → FAILED immediately with the BC message for the admin view.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignment, bcTransfer, consumption, serviceOrder, timeEntry } from '../db/schema.js';
import type { TransferPayload } from '../modules/transfer/transfer.service.js';
import { BcContractError, BcError, type BcClient } from './bc-client.js';

export const MAX_ATTEMPTS = 10;
const STALE_LOCK_MS = 10 * 60_000;

export function backoffMs(attempt: number, random = Math.random()): number {
  return Math.min(30_000 * 2 ** attempt, 3_600_000) * (0.75 + random / 2);
}

type Transfer = typeof bcTransfer.$inferSelect;

export class BcTransferWorker {
  constructor(
    private readonly db: Db,
    private readonly clientFor: (companyId: string) => BcClient,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  /** Processes due transfers until none is left (bounded). Returns counts per outcome. */
  async runOnce(limit = 50): Promise<Record<string, number>> {
    await this.releaseStaleLocks();
    const stats: Record<string, number> = {};
    for (let i = 0; i < limit; i++) {
      const t = await this.claim();
      if (!t) break;
      const outcome = await this.execute(t);
      stats[outcome] = (stats[outcome] ?? 0) + 1;
    }
    return stats;
  }

  private async releaseStaleLocks() {
    await this.db
      .update(bcTransfer)
      .set({ state: 'PENDING', lockedAt: null })
      .where(
        and(
          eq(bcTransfer.state, 'IN_PROGRESS'),
          sql`${bcTransfer.lockedAt} < now() - make_interval(secs => ${STALE_LOCK_MS / 1000})`,
        ),
      );
  }

  private async claim(): Promise<Transfer | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        select t.id from bc_transfer t
        where t.state = 'PENDING' and t.next_attempt_at <= now()
          and not exists (
            select 1 from bc_transfer p
            where p.group_key = t.group_key and p.created_at < t.created_at and p.state <> 'DONE'
          )
        order by t.created_at
        limit 1
        for update skip locked`);
      const id = (rows.rows[0] as { id: string } | undefined)?.id;
      if (!id) return null;
      const [t] = await tx
        .update(bcTransfer)
        .set({ state: 'IN_PROGRESS', lockedAt: new Date() })
        .where(eq(bcTransfer.id, id))
        .returning();
      return t ?? null;
    });
  }

  private async execute(t: Transfer): Promise<'done' | 'retry' | 'failed' | 'dead'> {
    const payload = t.payload as unknown as TransferPayload;
    const bc = this.clientFor(t.bcCompanyId);
    try {
      let recordId: string;
      if (payload.op === 'create') {
        const res = await bc.create(payload.endpoint, { ...payload.body, monteurAppId: t.id });
        recordId = String((res.record as { id: string }).id);
      } else {
        const target = await this.resolveRef(payload.ref);
        if (!target)
          throw new BcError(0, 'ReferenceMissing', 'Der BC-Datensatz ist (noch) nicht bekannt', false);
        const current = await bc.get(payload.endpoint, target);
        const res = await bc.patch(payload.endpoint, target, current.etag ?? '*', payload.body);
        recordId = String((res.record as { id: string }).id);
      }
      await this.db.transaction(async (tx) => {
        await tx
          .update(bcTransfer)
          .set({
            state: 'DONE',
            bcRecordId: recordId,
            lockedAt: null,
            lastError: null,
            attempts: t.attempts + 1,
          })
          .where(eq(bcTransfer.id, t.id));
        if (t.target === 'ALLOCATION' && payload.op === 'create')
          await tx.update(assignment).set({ bcAllocationId: recordId }).where(eq(assignment.id, t.subjectId));
        const ids = payload.op === 'create' ? payload.meta?.timeEntryIds : undefined;
        if (ids?.length)
          await tx
            .update(timeEntry)
            .set({ state: 'TRANSFERRED' })
            .where(and(inArray(timeEntry.id, ids), eq(timeEntry.state, 'APPROVED')));
        const cIds = payload.op === 'create' ? payload.meta?.consumptionIds : undefined;
        if (cIds?.length)
          await tx
            .update(consumption)
            .set({ state: 'TRANSFERRED' })
            .where(and(inArray(consumption.id, cIds), eq(consumption.state, 'APPROVED')));
      });
      return 'done';
    } catch (e) {
      const retryable =
        e instanceof BcError ? e.retryable || e.status === 412 : !(e instanceof BcContractError);
      const message = e instanceof Error ? e.message : String(e);
      const attempts = t.attempts + 1;
      if (!retryable) {
        await this.db
          .update(bcTransfer)
          .set({ state: 'FAILED', attempts, lastError: message, lockedAt: null })
          .where(eq(bcTransfer.id, t.id));
        this.log(`[bc-transfer] ${t.id} ${t.target} failed: ${message}`);
        return 'failed';
      }
      if (attempts >= MAX_ATTEMPTS) {
        await this.db
          .update(bcTransfer)
          .set({ state: 'DEAD', attempts, lastError: message, lockedAt: null })
          .where(eq(bcTransfer.id, t.id));
        this.log(`[bc-transfer] ${t.id} ${t.target} dead after ${attempts} attempts: ${message}`);
        return 'dead';
      }
      await this.db
        .update(bcTransfer)
        .set({
          state: 'PENDING',
          attempts,
          lastError: message,
          lockedAt: null,
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts - 1)),
        })
        .where(eq(bcTransfer.id, t.id));
      return 'retry';
    }
  }

  private async resolveRef(ref: {
    table: 'assignment' | 'service_order';
    id: string;
  }): Promise<string | null> {
    if (ref.table === 'assignment') {
      const [a] = await this.db
        .select({ id: assignment.bcAllocationId })
        .from(assignment)
        .where(eq(assignment.id, ref.id));
      return a?.id ?? null;
    }
    const [o] = await this.db
      .select({ id: serviceOrder.bcSystemId })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, ref.id));
    return o?.id ?? null;
  }
}
