/**
 * Sync engine (ARCHITEKTUR 4): local-first commands → outbox → POST /v1/sync/push, then delta pull.
 * Triggers: after each command (debounced), `online` event, app focus, interval. iOS has no Background Sync API,
 * therefore focus/interval are the primary triggers on all platforms (ENTSCHEIDUNGEN E-32).
 */
import {
  estimateDelivery,
  STAMP_COMMAND_KIND,
  type AppStatus,
  type Bundesland,
  type CommandResult,
  type CommandType,
  type CommandPayload,
  type PushResponse,
} from '@schroeder/shared';
import {
  kvGet,
  kvSet,
  type LocalAssignment,
  type LocalChatMessage,
  type LocalChatRead,
  type LocalPhoto,
  type LocalTemplate,
  type LocalWorkReport,
  type LocalConsumption,
  type LocalContainer,
  type LocalItem,
  type LocalOrder,
  type LocalPartRequest,
  type LocalStock,
  type LocalStorage,
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
  await db.transaction(
    'rw',
    [
      db.outbox,
      db.stampEvents,
      db.orders,
      db.statusEvents,
      db.consumptions,
      db.stocks,
      db.partRequests,
      db.kv,
      db.items,
      db.workReports,
      db.chatMessages,
      db.photos,
    ],
    async () => {
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
      if (type === 'ConsumeItem') {
        const p = payload as CommandPayload<'ConsumeItem'>;
        const it = await db.items.get(p.itemId);
        await db.consumptions.put({
          id,
          userId: ownerId,
          orderId: p.orderId ?? null,
          itemId: p.itemId,
          storageLocationId: p.storageLocationId,
          containerId: p.containerId ?? null,
          quantity: p.quantity,
          unit: it?.unit ?? '',
          costCenter: p.costCenter ?? null,
          internalPurpose: p.internalPurpose ?? null,
          deviceTime: at.toISOString(),
          state: 'SUBMITTED',
          pending: true,
        });
        await adjustLocalStock(db, p.itemId, p.storageLocationId, p.quantity);
      }
      if (type === 'RemoveConsumption') {
        const c = await db.consumptions.get((payload as { consumptionId: string }).consumptionId);
        if (c && c.state === 'SUBMITTED') {
          await db.consumptions.update(c.id, { state: 'REJECTED' });
          await adjustLocalStock(db, c.itemId, c.storageLocationId, -c.quantity);
        }
      }
      if (type === 'SaveWorkReport') {
        const p = payload as CommandPayload<'SaveWorkReport'>;
        await db.workReports.put({
          orderId: p.orderId,
          body: p.body,
          requiredFields: p.requiredFields,
          usedTemplateIds: p.usedTemplateIds,
          complete: false,
          deviceTime: at.toISOString(),
          pending: true,
        });
      }
      if (type === 'SendChatMessage') {
        const p = payload as CommandPayload<'SendChatMessage'>;
        await db.chatMessages.put({
          id,
          orderId: p.orderId,
          authorId: ownerId,
          authorName: null,
          serverSeq: null,
          body: p.body,
          photoId: p.photoId ?? null,
          isSystem: false,
          clientCreatedAt: at.toISOString(),
          createdAt: at.toISOString(),
          pending: true,
        });
      }
      if (type === 'AttachPhoto') {
        const p = payload as CommandPayload<'AttachPhoto'>;
        await db.photos.put({
          id,
          orderId: p.orderId,
          category: p.category,
          capturedAt: p.capturedAt,
          uploadState: 'PENDING',
          width: p.width,
          height: p.height,
        });
      }
      if (type === 'RequestPart') {
        const p = payload as CommandPayload<'RequestPart'>;
        const loc = await kvGet<{ timezone: string; bundesland?: string }>(db, 'location');
        const settings = (await kvGet<Array<{ key: string; value: unknown }>>(db, 'settings')) ?? [];
        const cutoff =
          (settings.find((x) => x.key === 'partsCutoff')?.value as { time?: string } | undefined)?.time ??
          '17:00';
        const est = estimateDelivery(
          at,
          loc?.timezone ?? 'Europe/Berlin',
          (loc?.bundesland ?? 'NI') as Bundesland,
          cutoff,
        );
        await db.partRequests.put({
          id,
          orderId: p.orderId,
          itemId: p.itemId ?? null,
          newItemText: p.newItemText ?? null,
          manufacturerPartNo: p.manufacturerPartNo ?? null,
          quantity: p.quantity,
          expectedDelivery: est.deliveryDate,
          state: 'OFFEN',
          pending: true,
        });
        if (p.setWaitingForParts)
          await setLocalStatus(
            db,
            p.orderId,
            'WARTET_TEILE',
            AUTO_WORK_FROM.concat(['IN_ARBEIT']),
            'BESTELLUNG',
            at,
          );
      }
    },
  );
  return id;
}

/** Local stock reduction (works offline); reconciled with the server values on the next pull. */
async function adjustLocalStock(db: MonteurDb, itemId: string, storageLocationId: string, delta: number) {
  const key: [string, string] = [itemId, storageLocationId];
  const row = await db.stocks.get(key);
  if (row) await db.stocks.put({ ...row, pendingWithdrawal: row.pendingWithdrawal + delta });
  else
    await db.stocks.put({
      itemId,
      storageLocationId,
      bcInventory: 0,
      pendingWithdrawal: delta,
      minStock: null,
    });
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
  storages?: LocalStorage[];
  items?: LocalItem[];
  stocks?: LocalStock[];
  containers?: LocalContainer[];
  consumptions?: LocalConsumption[];
  partRequests?: LocalPartRequest[];
  workReports?: Array<LocalWorkReport & { deviceTime: string | null }>;
  templates?: LocalTemplate[];
  chatMessages?: LocalChatMessage[];
  chatReads?: LocalChatRead[];
  photos?: LocalPhoto[];
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
    db.items,
    db.storages,
    db.stocks,
    db.containers,
    db.consumptions,
    db.partRequests,
    db.workReports,
    db.templates,
    db.chatMessages,
    db.chatReads,
    db.photos,
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
      await Promise.all([db.items.clear(), db.storages.clear(), db.stocks.clear(), db.containers.clear()]);
      await db.consumptions.filter((c) => !c.pending).delete();
      await db.partRequests.filter((c) => !c.pending).delete();
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
    await applyMaterial(db, ownerId, res);
    await applyCommunication(db, res);
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

/**
 * Material cache from the pull. Server stock already contains every withdrawal that was pushed; withdrawals
 * still waiting in the outbox are re-applied to the rows that were just overwritten.
 */
async function applyMaterial(db: MonteurDb, ownerId: string, res: PullResponse) {
  if (res.storages) await db.storages.bulkPut(res.storages);
  if (res.items) await db.items.bulkPut(res.items);
  if (res.containers) await db.containers.bulkPut(res.containers);
  if (res.consumptions)
    await db.consumptions.bulkPut(res.consumptions.map((c) => ({ ...c, pending: false })));
  if (res.partRequests)
    await db.partRequests.bulkPut(res.partRequests.map((c) => ({ ...c, pending: false })));
  if (res.stocks?.length) {
    await db.stocks.bulkPut(
      res.stocks.map((x) => ({
        itemId: x.itemId,
        storageLocationId: x.storageLocationId,
        bcInventory: Number(x.bcInventory),
        pendingWithdrawal: Number(x.pendingWithdrawal),
        minStock: x.minStock,
      })),
    );
    const overwritten = new Set(res.stocks.map((x) => `${x.itemId}|${x.storageLocationId}`));
    const waiting = await db.outbox
      .where('ownerOid')
      .equals(ownerId)
      .filter((e) => e.status === 'pending')
      .toArray();
    for (const e of waiting) {
      if (e.type === 'ConsumeItem') {
        const p = e.payload as CommandPayload<'ConsumeItem'>;
        if (overwritten.has(`${p.itemId}|${p.storageLocationId}`))
          await adjustLocalStock(db, p.itemId, p.storageLocationId, p.quantity);
      }
      if (e.type === 'RemoveConsumption') {
        const c = await db.consumptions.get((e.payload as { consumptionId: string }).consumptionId);
        if (c && overwritten.has(`${c.itemId}|${c.storageLocationId}`))
          await adjustLocalStock(db, c.itemId, c.storageLocationId, -c.quantity);
      }
    }
  }
}

/** Reports, templates, chat and photo metadata. Local unsent edits are kept until the server confirms them. */
async function applyCommunication(db: MonteurDb, res: PullResponse) {
  if (res.full) await db.templates.clear();
  if (res.templates) await db.templates.bulkPut(res.templates);
  for (const r of res.workReports ?? []) {
    const local = await db.workReports.get(r.orderId);
    if (local?.pending && local.deviceTime && r.deviceTime && local.deviceTime > r.deviceTime) continue;
    await db.workReports.put({
      orderId: r.orderId,
      body: r.body,
      requiredFields: r.requiredFields,
      usedTemplateIds: r.usedTemplateIds,
      complete: r.complete,
      deviceTime: r.deviceTime,
      pending: false,
    });
  }
  if (res.chatMessages?.length)
    await db.chatMessages.bulkPut(res.chatMessages.map((m) => ({ ...m, pending: false })));
  if (res.chatReads?.length) await db.chatReads.bulkPut(res.chatReads);
  if (res.photos?.length) await db.photos.bulkPut(res.photos);
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
