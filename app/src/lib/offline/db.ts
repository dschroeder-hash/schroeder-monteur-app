import Dexie, { type EntityTable, type Table } from 'dexie';
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

export interface LocalItem {
  id: string;
  number: string;
  name: string;
  unit: string;
  category: string;
  gtin: string;
  isConsumable: boolean;
  blocked: boolean;
  imageUrl: string | null;
  barcodes: string[];
}

export interface LocalStorage {
  id: string;
  locationId: string;
  bcLocationCode: string;
  name: string;
  kind: 'LAGER' | 'SERVICEWAGEN' | 'TANK';
}

export interface LocalStock {
  itemId: string;
  storageLocationId: string;
  bcInventory: number;
  pendingWithdrawal: number;
  minStock: number | null;
}

export interface LocalContainer {
  id: string;
  locationId: string;
  storageLocationId: string;
  itemId: string;
  kind: 'FASS' | 'IBC' | 'TANK' | 'KANISTER' | 'KARTUSCHE';
  name: string;
  capacity: number | null;
  minStock: number | null;
  hasMeter: boolean;
  quickQuantities: number[];
  active: boolean;
}

export interface LocalConsumption {
  id: string;
  userId: string;
  orderId: string | null;
  itemId: string;
  storageLocationId: string;
  containerId: string | null;
  quantity: number;
  unit: string;
  costCenter: string | null;
  internalPurpose: string | null;
  deviceTime: string;
  state: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'TRANSFERRED' | 'OPEN';
  pending?: boolean;
}

export interface LocalPartRequest {
  id: string;
  orderId: string;
  itemId: string | null;
  newItemText: string | null;
  manufacturerPartNo: string | null;
  quantity: number;
  expectedDelivery: string | null;
  state: 'OFFEN' | 'BESTELLT' | 'GELIEFERT' | 'STORNIERT';
  pending?: boolean;
}

/** Shopping cart per order (local only until "Entnehmen"). */
export interface CartLine {
  id: string;
  orderId: string;
  itemId: string;
  storageLocationId: string;
  quantity: number;
}

export interface LocalWorkReport {
  orderId: string;
  body: string;
  requiredFields: Record<string, string | number | null>;
  usedTemplateIds: string[];
  complete: boolean;
  deviceTime: string | null;
  pending?: boolean;
}

export interface LocalTemplate {
  id: string;
  locationId: string | null;
  orderTypeCode: string | null;
  machineGroup: string | null;
  title: string;
  body: string;
  sortOrder: number;
  active: boolean;
}

export interface LocalChatMessage {
  id: string;
  orderId: string;
  authorId: string | null;
  authorName: string | null;
  serverSeq: number | null;
  body: string;
  photoId: string | null;
  isSystem: boolean;
  clientCreatedAt: string | null;
  createdAt: string;
  pending?: boolean;
}

export interface LocalChatRead {
  messageId: string;
  userId: string;
  readAt: string;
}

export interface LocalPhoto {
  id: string;
  orderId: string;
  category: 'VORHER' | 'NACHHER' | 'TYPENSCHILD' | 'BSZ' | 'TEIL' | 'SONSTIGES';
  capturedAt: string | null;
  uploadState: 'PENDING' | 'UPLOADED' | 'FAILED';
  width: number | null;
  height: number | null;
}

/** Photo binary waiting for (or during) the resumable upload. Removed after upload. */
export interface PhotoBlob {
  id: string;
  orderId: string;
  blob: Blob;
  state: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
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
  items!: EntityTable<LocalItem, 'id'>;
  storages!: EntityTable<LocalStorage, 'id'>;
  stocks!: Table<LocalStock, [string, string]>;
  containers!: EntityTable<LocalContainer, 'id'>;
  consumptions!: EntityTable<LocalConsumption, 'id'>;
  partRequests!: EntityTable<LocalPartRequest, 'id'>;
  cart!: EntityTable<CartLine, 'id'>;
  workReports!: EntityTable<LocalWorkReport, 'orderId'>;
  templates!: EntityTable<LocalTemplate, 'id'>;
  chatMessages!: EntityTable<LocalChatMessage, 'id'>;
  chatReads!: Table<LocalChatRead, [string, string]>;
  photos!: EntityTable<LocalPhoto, 'id'>;
  photoBlobs!: EntityTable<PhotoBlob, 'id'>;

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
    this.version(3).stores({
      items: 'id, number, gtin, *barcodes, name, isConsumable',
      storages: 'id, kind',
      stocks: '[itemId+storageLocationId], itemId, storageLocationId',
      containers: 'id, storageLocationId',
      consumptions: 'id, orderId, state',
      partRequests: 'id, orderId',
      cart: 'id, orderId',
    });
    this.version(4).stores({
      workReports: 'orderId',
      templates: 'id',
      chatMessages: 'id, orderId, serverSeq',
      chatReads: '[messageId+userId], messageId',
      photos: 'id, orderId',
      photoBlobs: 'id, state, orderId',
    });
  }

  /** Removes all cached personal data (logout). The outbox is kept only if the caller decides so. */
  async clearCache(keepOutbox: boolean) {
    const tables = [
      this.orders,
      this.assignments,
      this.stampEvents,
      this.timeEntries,
      this.statusEvents,
      this.overheadTypes,
      this.notices,
      this.kv,
      this.items,
      this.storages,
      this.stocks,
      this.containers,
      this.consumptions,
      this.partRequests,
      this.cart,
      this.workReports,
      this.templates,
      this.chatMessages,
      this.chatReads,
      this.photos,
      this.photoBlobs,
    ];
    await this.transaction('rw', [...tables, this.outbox], async () => {
      await Promise.all(tables.map((t) => t.clear()));
      if (!keepOutbox) await this.outbox.clear();
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

export async function kvGet<T>(db: MonteurDb, key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}
export async function kvSet(db: MonteurDb, key: string, value: unknown) {
  await db.kv.put({ key, value });
}
