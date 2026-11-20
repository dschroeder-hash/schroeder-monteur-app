import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AccessScope } from '../../auth/auth.types.js';
import type { Db } from '../../db/client.js';
import {
  appUser,
  consumption,
  location,
  serviceOrder,
  setting,
  timeCorrectionRequest,
} from '../../db/schema.js';
import type { ApprovalsService } from './approvals.service.js';

/** Technical actor of the automatic hand-over (migration 0014). */
export const SYSTEM_USER_ID = '00000000-0000-0000-0000-00000000a170';

export interface AutoApproveConfig {
  /** 'auto': no Meister in the app – everything goes to BC without a check (E-66). 'meister': approval inbox. */
  mode: 'auto' | 'meister';
  /** A day/withdrawal is handed over only this long after the last change, so the Monteur can still undo. */
  graceMinutes: number;
}

export async function autoApproveConfig(db: Db): Promise<AutoApproveConfig> {
  const [row] = await db
    .select()
    .from(setting)
    .where(and(eq(setting.key, 'approval'), sql`${setting.locationId} is null`));
  const v = (row?.value ?? {}) as Partial<AutoApproveConfig>;
  return { mode: v.mode === 'meister' ? 'meister' : 'auto', graceMinutes: v.graceMinutes ?? 30 };
}

/**
 * Worker job replacing the Meister approval (E-66): finished working days, withdrawals, correction requests and
 * orders marked "Arbeit abgeschlossen" are handed to BC through the transfer queue – with the same rules as before
 * (rounding, work types, one line per withdrawal), audited as actor "Automatik". Errors of one item (e.g. no BC
 * resource mapped) are reported and retried in the next run; they do not block the others.
 */
export async function runAutoApprove(
  db: Db,
  approvals: ApprovalsService,
  warn: (m: string) => void = console.warn,
): Promise<Record<string, number>> {
  const cfg = await autoApproveConfig(db);
  if (cfg.mode !== 'auto') return {};
  // Created by migration 0014; re-created here if a reset (e.g. the dev seed) removed it.
  await db
    .insert(appUser)
    .values({
      id: SYSTEM_USER_ID,
      entraOid: SYSTEM_USER_ID,
      displayName: 'Automatik',
      email: 'automatik@system.invalid',
      active: false,
    })
    .onConflictDoNothing();
  const locs = await db.select({ id: location.id }).from(location);
  const ids = locs.map((l) => l.id);
  const scope: AccessScope = {
    userId: SYSTEM_USER_ID,
    principal: { oid: SYSTEM_USER_ID, name: 'Automatik', email: '', roles: [] },
    roles: ['Werkstatt.Meister'] as AccessScope['roles'],
    grants: [],
    monteurLocationIds: [],
    meisterLocationIds: ids,
    lagerLocationIds: [],
    locationIds: ids,
  };
  const stats = { corrections: 0, days: 0, withdrawals: 0, orders: 0, errors: 0 };
  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (e) {
      stats.errors++;
      const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : '';
      warn(`[auto-approve] ${what}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}${cause}`);
      return false;
    }
  };

  // 1. Correction requests of the Monteur (e.g. forgotten clock-out) are taken over as entered.
  const reqs = await db
    .select({ id: timeCorrectionRequest.id })
    .from(timeCorrectionRequest)
    .where(eq(timeCorrectionRequest.state, 'OFFEN'));
  for (const r of reqs)
    if (
      await attempt(`correction ${r.id}`, () =>
        approvals.decideCorrection(scope, r.id, 'ANGENOMMEN', 'automatisch übernommen'),
      )
    )
      stats.corrections++;

  // 2. Closed working days: nothing running, no correction pending, last booking older than the grace period.
  const days = await db.execute(sql`
    select te.user_id, te.work_date::text as work_date
    from time_entry te
    where te.state = 'OPEN'
    group by te.user_id, te.work_date
    having bool_and(te.end_at is not null) and not bool_or(te.needs_correction)
      and max(te.end_at) < now() - make_interval(mins => ${cfg.graceMinutes})
      and not exists (select 1 from time_correction_request r
                      where r.user_id = te.user_id and r.state = 'OFFEN')`);
  for (const d of days.rows as Array<{ user_id: string; work_date: string }>)
    if (
      await attempt(`day ${d.user_id} ${d.work_date}`, () =>
        approvals.approveDay(scope, d.user_id, d.work_date),
      )
    )
      stats.days++;

  // 3. Withdrawals – after the grace period, or at once when the order is finished.
  const subs = await db
    .select({ id: consumption.id })
    .from(consumption)
    .leftJoin(serviceOrder, eq(serviceOrder.id, consumption.orderId))
    .where(
      and(
        eq(consumption.state, 'SUBMITTED'),
        sql`(${consumption.createdAt} < now() - make_interval(mins => ${cfg.graceMinutes})
             or ${serviceOrder.appStatus} in ('FERTIG', 'FREIGEGEBEN'))`,
      ),
    );
  if (
    subs.length &&
    (await attempt('withdrawals', () =>
      approvals.approveConsumptions(
        scope,
        subs.map((s) => s.id),
      ),
    ))
  )
    stats.withdrawals = subs.length;

  // 4. "Arbeit abgeschlossen": report (and checklist, signature) plus status to BC.
  const done = await db
    .select({ id: serviceOrder.id })
    .from(serviceOrder)
    .where(inArray(serviceOrder.appStatus, ['FERTIG']));
  for (const o of done)
    if (
      await attempt(`order ${o.id}`, () =>
        approvals.setOrderStatus(scope, o.id, 'FREIGEGEBEN', undefined, 'AUTO'),
      )
    )
      stats.orders++;
  return stats;
}
