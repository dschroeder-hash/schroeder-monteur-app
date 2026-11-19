import Dexie, { type EntityTable } from 'dexie';
import type { AppStatus, StampKind, Activity } from '@schroeder/shared';

/** A command written while (possibly) offline; sent to POST /v1/sync/push in device order (ENTSCHEIDUNGEN E-06). */
export interface OutboxEntry {
  seq?: number;
  id: string;
  type: string;
  payload: unknown;
  deviceTime: string;
  ownerOid: string;
  status: 'pending' | 'sending' | 'rejected';
  error?: string;
}

export interface KvEntry {
  key: string;
  value: unknown;
}

export interface LocalMachine {
  id: string;
  brand: string;
  model: string;
  serialNo: string;
  machineGroup: string;
  operatingHours: number | null;
}

export interface LocalOrder {
  id: string;
  bcNo: string;
  description: string;
  orderTypeCode: string;
  appStatus: AppStatus;
  bcStatus: string;
  priority: string;
  responseDate: string | null;
  customerNo: string;
  customerName: string;
  address: { street: string; street2: string; postCode: string; city: string; country: string } | null;
  contactName: string;
  contactPhone: string;
  contactMobile: string;
  faultDescription: string;
  locationId: string;
  items: Array<{ lineNo: number; description: string; faultComment: string; machine: LocalMachine | null }>;
}

export interface LocalAssignment {
  id: string;
  orderId: string;
  userId: string;
  plannedStart: string;
  plannedEnd: string;
  cancelledAt: string | null;
}

export interface LocalStampEvent {
  id: string;
  userId: string;
  kind: StampKind;
  orderId: string | null;
  activity: Activity | null;
  overheadCode: string | null;
  deviceTime: string;
  /** true until confirmed by the server */
  pending?: boolean;
  seq?: number;
}

export interface LocalTimeEntry {
  id: string;
  userId: string;
  workDate: string;
  kind: 'ATTENDANCE' | 'ORDER' | 'OVERHEAD' | 'BREAK';
  orderId: string | null;
  activity: Activity | null;
  startAt: string;
  endAt: string | null;
  actualMinutes: number | null;
  billableMinutes: number | null;
  state: string;
  needsCorrection: boolean;
  skewFlag: boolean;
}

export interface LocalStatusEvent {
  id: string;
  orderId: string;
  fromStatus: AppStatus | null;
  toStatus: AppStatus;
  source: string;
  at: string;
  /** optimistic local entry, replaced by the server version after sync */
  pending?: boolean;
}

export interface LocalOverheadType {
  code: string;
  label: string;
  active: boolean;
}

export interface Notice {
  id: string;
  kind: 'warning' | 'info' | 'error';
  text: string;
  at: string;
}

/** Local-first store (ARCHITEKTUR 4). Personal data lives only here – the service worker caches no API data (E-30). */
export class MonteurDb extends Dexie {
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  kv!: EntityTable<KvEntry, 'key'>;
  orders!: EntityTable<LocalOrder, 'id'>;
  assignments!: EntityTable<LocalAssignment, 'id'>;
  stampEvents!: EntityTable<LocalStampEvent, 'id'>;
  timeEntries!: EntityTable<LocalTimeEntry, 'id'>;
  statusEvents!: EntityTable<LocalStatusEvent, 'id'>;
  overheadTypes!: EntityTable<LocalOverheadType, 'code'>;
  notices!: EntityTable<Notice, 'id'>;

  constructor(name = 'schroeder-monteur') {
    super(name);
    this.version(1).stores({ outbox: '++seq, id, status, ownerOid', kv: 'key' });
    this.version(2).stores({
      orders: 'id, appStatus',
      assignments: 'id, orderId, plannedStart',
      stampEvents: 'id, deviceTime, userId',
      timeEntries: 'id, workDate, orderId',
      statusEvents: 'id, orderId, at',
      overheadTypes: 'code',
      notices: 'id, at',
    });
  }

  /** Removes all cached personal data (logout). The outbox is kept only if the caller decides so. */
  async clearCache(keepOutbox: boolean) {
    await this.transaction(
      'rw',
      [
        this.orders,
        this.assignments,
        this.stampEvents,
        this.timeEntries,
        this.statusEvents,
        this.overheadTypes,
        this.notices,
        this.kv,
        this.outbox,
      ],
      async () => {
        await Promise.all([
          this.orders.clear(),
          this.assignments.clear(),
          this.stampEvents.clear(),
          this.timeEntries.clear(),
          this.statusEvents.clear(),
          this.overheadTypes.clear(),
          this.notices.clear(),
          this.kv.clear(),
        ]);
        if (!keepOutbox) await this.outbox.clear();
      },
    );
  }
}

export const localDb = new MonteurDb();

export async function enqueue(
  db: MonteurDb,
  e: Omit<OutboxEntry, 'seq' | 'status' | 'deviceTime'> & { deviceTime?: Date },
) {
  return db.outbox.add({ ...e, deviceTime: (e.deviceTime ?? new Date()).toISOString(), status: 'pending' });
}

export async function pendingCount(db: MonteurDb, ownerOid: string) {
  return db.outbox
    .where('ownerOid')
    .equals(ownerOid)
    .filter((e) => e.status !== 'rejected')
    .count();
}

export async function kvGet<T>(db: MonteurDb, key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}
export async function kvSet(db: MonteurDb, key: string, value: unknown) {
  await db.kv.put({ key, value });
}
