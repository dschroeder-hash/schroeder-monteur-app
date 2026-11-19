import Dexie, { type EntityTable } from 'dexie';

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

/** Local-first store. Phase 2 adds the cached domain tables (orders, items, consumables, templates). */
export class MonteurDb extends Dexie {
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  kv!: EntityTable<KvEntry, 'key'>;

  constructor(name = 'schroeder-monteur') {
    super(name);
    this.version(1).stores({
      outbox: '++seq, id, status, ownerOid',
      kv: 'key',
    });
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
