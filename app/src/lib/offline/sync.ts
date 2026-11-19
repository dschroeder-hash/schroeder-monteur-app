/**
 * Sync engine (ARCHITEKTUR 4): local-first commands → outbox → POST /v1/sync/push, then delta pull.
 * Triggers: after each command (debounced), `online` event, app focus, interval. iOS has no Background Sync API,
 * therefore focus/interval are the primary triggers on all platforms (ENTSCHEIDUNGEN E-32).
 */
import {
  STAMP_COMMAND_KIND,
  type AppStatus,
  type CommandResult,
  type CommandType,
  type CommandPayload,
  type PushResponse,
} from '@schroeder/shared';
import {
  kvGet,
  kvSet,
  type LocalAssignment,
  type LocalOrder,
  type LocalStampEvent,
  type LocalTimeEntry,
  type MonteurDb,
  type Notice,
} from './db';

export interface CorrectionRequest {
  id: string;
  workDate: string;
  proposal: Array<{ kind: string; time: string }>;
  state: 'OFFEN' | 'ANGENOMMEN' | 'ABGELEHNT';
  decisionReason: string | null;
}

export type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

const AUTO_WORK_FROM: AppStatus[] = [
  'NEU',
  'EINGEPLANT',
  'UNTERWEGS',
  'WARTET_TEILE',
  'WARTET_KUNDE',
  'FERTIG_DOKU_OFFEN',
];
const AUTO_TRAVEL_FROM: AppStatus[] = ['NEU', 'EINGEPLANT'];
const TRANSIENT = 'Vorübergehender Fehler';

function uuid(): string {
  return crypto.randomUUID();
}

async function notice(db: MonteurDb, kind: Notice['kind'], text: string) {
  await db.notices.put({ id: uuid(), kind, text, at: new Date().toISOString() });
}

export async function deviceId(db: MonteurDb): Promise<string> {
  let id = await kvGet<string>(db, 'deviceId');
  if (!id) {
    id = `dev-${uuid()}`;
    await kvSet(db, 'deviceId', id);
  }
  return id;
}

/**
 * Records a command locally (outbox) and applies its effect to the local cache immediately (optimistic),
 * so the UI works the same online and offline.
 */
export async function recordCommand<T extends CommandType>(
  db: MonteurDb,
  ownerId: string,
  type: T,
  payload: CommandPayload<T>,
  at: Date = new Date(),
): Promise<string> {
  const id = uuid();
  await db.transaction('rw', [db.outbox, db.stampEvents, db.orders, db.statusEvents], async () => {
    // The auto-increment key of the outbox is the device sequence (monotonic per device).
    const seq = (await db.outbox.add({
      id,
      type,
      payload,
      deviceTime: at.toISOString(),
      ownerOid: ownerId,
      status: 'pending',
    })) as number;
    if (type in STAMP_COMMAND_KIND) {
      const p = payload as {
        orderId?: string;
        activity?: 'WORK' | 'TRAVEL' | 'DIAGNOSIS';
        overheadCode?: string;
      };
      const kind = STAMP_COMMAND_KIND[type as keyof typeof STAMP_COMMAND_KIND];
      await db.stampEvents.put({
        id,
        userId: ownerId,
        kind,
        orderId: p.orderId ?? null,
        activity: p.activity ?? null,
        overheadCode: p.overheadCode ?? null,
        deviceTime: at.toISOString(),
        pending: true,
        seq,
      });
      if (kind === 'JOB_START' && p.orderId) {
        const travel = p.activity === 'TRAVEL';
        await setLocalStatus(
          db,
          p.orderId,
          travel ? 'UNTERWEGS' : 'IN_ARBEIT',
          travel ? AUTO_TRAVEL_FROM : AUTO_WORK_FROM,
          'STEMPELUNG',
          at,
        );
      }
    }
    if (type === 'SetOrderStatus') {
      const p = payload as { orderId: string; status: AppStatus };
      await setLocalStatus(db, p.orderId, p.status, null, 'MONTEUR', at);
    }
  });
  return id;
}

async function setLocalStatus(
  db: MonteurDb,
  orderId: string,
  to: AppStatus,
  onlyFrom: AppStatus[] | null,
  source: string,
  at: Date,
) {
  const o = await db.orders.get(orderId);
  if (!o || o.appStatus === to || (onlyFrom && !onlyFrom.includes(o.appStatus))) return;
  await db.orders.update(orderId, { appStatus: to });
  await db.statusEvents.put({
    id: uuid(),
    orderId,
    fromStatus: o.appStatus,
    toStatus: to,
    source,
    at: at.toISOString(),
    pending: true,
  });
}

/** Sends pending commands in device order. Stops at the first transient error to keep the order intact. */
export async function pushOutbox(
  db: MonteurDb,
  ownerId: string,
  fetcher: Fetcher,
): Promise<{ sent: number; rejected: number }> {
  // Batches of 200 keep requests small after long offline phases; the loop in syncNow sends the rest.
  const pending = (await db.outbox.where('ownerOid').equals(ownerId).sortBy('seq'))
    .filter((e) => e.status !== 'rejected')
    .slice(0, 200);
  if (!pending.length) return { sent: 0, rejected: 0 };
  const res = await fetcher<PushResponse>('/v1/sync/push', {
    method: 'POST',
    body: JSON.stringify({
      deviceId: await deviceId(db),
      deviceNow: new Date().toISOString(),
      commands: pending.map((e) => ({
        id: e.id,
        type: e.type,
        deviceTime: e.deviceTime,
        deviceSeq: e.seq!,
        payload: e.payload,
      })),
    }),
  });
  let sent = 0;
  let rejected = 0;
  const byId = new Map(res.results.map((r: CommandResult) => [r.id, r]));
  for (const e of pending) {
    const r = byId.get(e.id);
    if (!r) break;
    if (r.result === 'rejected' && r.reason?.startsWith(TRANSIENT)) break;
    if (r.result === 'rejected') {
      rejected++;
      await db.outbox.update(e.seq!, { status: 'rejected', error: r.reason });
      await db.stampEvents.delete(e.id);
      await notice(db, 'error', `Nicht übernommen: ${r.reason ?? 'unbekannter Grund'}`);
      continue;
    }
    sent++;
    await db.outbox.delete(e.seq!);
    for (const w of r.warnings ?? []) await notice(db, 'warning', w);
  }
  if (res.skewFlagged && !(await kvGet<boolean>(db, 'skewNoticeShown'))) {
    await notice(
      db,
      'warning',
      'Die Uhrzeit Ihres Geräts weicht deutlich ab. Ihre Buchungen werden markiert – bitte Datum und Uhrzeit automatisch einstellen.',
    );
    await kvSet(db, 'skewNoticeShown', true);
  }
  return { sent, rejected };
}

interface PullResponse {
  cursor: string;
  full: boolean;
  serverTime: string;
  location: { id: string; code: string; name: string; timezone: string };
  orders: LocalOrder[];
  assignments: LocalAssignment[];
  stampEvents: LocalStampEvent[];
  timeEntries: LocalTimeEntry[];
  timeEntryKeysByDay: Record<string, string[]>;
  statusEvents: Array<{
    id: string;
    orderId: string;
    fromStatus: AppStatus | null;
    toStatus: AppStatus;
    source: string;
    at: string;
  }>;
  overheadTypes: Array<{ code: string; label: string; active: boolean }>;
  settings: Array<{ key: string; value: unknown; locationId: string | null }>;
  /** Stamp events voided by a Meister correction (E-37). */
  voidedEventIds?: string[];
  correctionRequests?: CorrectionRequest[];
}

/** Applies the server delta to the local cache. Locally pending stamp events are never overwritten. */
export async function pullChanges(db: MonteurDb, ownerId: string, fetcher: Fetcher): Promise<PullResponse> {
  const cursor = await kvGet<string>(db, 'cursor');
  const res = await fetcher<PullResponse>(`/v1/sync/pull${cursor ? `?cursor=${cursor}` : ''}`);
  const tables = [
    db.orders,
    db.assignments,
    db.stampEvents,
    db.timeEntries,
    db.statusEvents,
    db.overheadTypes,
    db.kv,
    db.notices,
    db.outbox,
  ];
  await db.transaction('rw', tables, async () => {
    const before = new Map((await db.assignments.toArray()).map((a) => [a.id, a]));
    if (res.full) {
      await Promise.all([
        db.orders.clear(),
        db.assignments.clear(),
        db.timeEntries.clear(),
        db.statusEvents.clear(),
      ]);
      await db.stampEvents.filter((e) => !e.pending).delete();
    }
    await db.orders.bulkPut(res.orders);
    await db.assignments.bulkPut(res.assignments);
    await db.stampEvents.bulkPut(res.stampEvents.map((e) => ({ ...e, pending: false })));
    if (res.voidedEventIds?.length) await db.stampEvents.bulkDelete(res.voidedEventIds);
    if (res.correctionRequests?.length) {
      const known = (await kvGet<CorrectionRequest[]>(db, 'correctionRequests')) ?? [];
      const merged = new Map([...known, ...res.correctionRequests].map((c) => [c.id, c]));
      await kvSet(db, 'correctionRequests', [...merged.values()]);
    }
    await db.timeEntries.bulkPut(res.timeEntries);
    for (const [day, ids] of Object.entries(res.timeEntryKeysByDay)) {
      const keep = new Set(ids);
      await db.timeEntries
        .where('workDate')
        .equals(day)
        .filter((e) => !keep.has(e.id))
        .delete();
    }
    await db.statusEvents.bulkPut(res.statusEvents);
    await db.overheadTypes.bulkPut(res.overheadTypes);
    await kvSet(db, 'location', res.location);
    await kvSet(db, 'settings', res.settings);
    await kvSet(db, 'cursor', res.cursor);
    await kvSet(db, 'lastSync', new Date().toISOString());

    // Planning changed by the Meister while offline → clear hint (ARCHITEKTUR 4.3).
    if (!res.full) {
      const changed = res.assignments.filter((a) => {
        const b = before.get(a.id);
        return !b || b.plannedStart !== a.plannedStart || b.cancelledAt !== a.cancelledAt;
      });
      if (changed.length) {
        const nos = await Promise.all(
          changed.map(async (a) => (await db.orders.get(a.orderId))?.bcNo ?? 'Auftrag'),
        );
        await notice(db, 'info', `Ihre Planung wurde geändert: ${[...new Set(nos)].join(', ')}`);
      }
    }

    // Optimistic status entries are superseded by the server's once nothing is waiting to be sent.
    if (
      (await db.outbox
        .where('ownerOid')
        .equals(ownerId)
        .filter((e) => e.status === 'pending')
        .count()) === 0
    )
      await db.statusEvents.filter((e) => !!e.pending).delete();

    // Drop orders that are no longer mine (no active assignment, no own time).
    const active = new Set(
      (await db.assignments.toArray())
        .filter((a) => a.userId === ownerId && !a.cancelledAt)
        .map((a) => a.orderId),
    );
    const withTime = new Set(
      (await db.timeEntries.toArray())
        .map((t) => t.orderId)
        .concat((await db.stampEvents.toArray()).map((e) => e.orderId)),
    );
    await db.orders.filter((o) => !active.has(o.id) && !withTime.has(o.id)).delete();
  });
  return res;
}

/** One sync cycle; single-flight per page. */
let inFlight: Promise<void> | null = null;
export function syncNow(db: MonteurDb, ownerId: string, fetcher: Fetcher): Promise<void> {
  inFlight ??= (async () => {
    try {
      // Push until the outbox is empty or blocked, then pull.
      for (let i = 0; i < 5; i++) {
        const r = await pushOutbox(db, ownerId, fetcher);
        if (r.sent === 0) break;
      }
      await pullChanges(db, ownerId, fetcher);
      await kvSet(db, 'lastSyncError', null);
    } catch (e) {
      await kvSet(db, 'lastSyncError', e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
