/**
 * BC → app delta sync (ARCHITEKTUR 5.4). Runs in the worker with the monteur_worker DB role.
 * Each entity keeps its own cursor (max lastModifiedDateTime seen); reads overlap by 5 s and upsert,
 * so repeated or overlapping runs are harmless.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  appStatusFromBc,
  DEFAULT_CONSUMABLE_CATEGORIES,
  DEFAULT_STATUS_DEFINITIONS,
  zonedToUtc,
  type AppStatus,
  type BcServiceStatus,
} from '@schroeder/shared';
import { EMPTY_GUID, type EntityOf } from '@schroeder/bc-contract';
import type pg from 'pg';
import type { Db } from '../db/client.js';
import {
  assignment,
  bcChecklistLine,
  bcContact,
  bcRemark,
  itemSubstitution,
  bcResourceMapping,
  bcSyncCursor,
  bcTransfer,
  consumption,
  customer,
  item,
  itemBarcode,
  itemStock,
  location,
  machine,
  orderStatusEvent,
  orderType,
  serviceOrder,
  serviceOrderItem,
  setting,
  storageLocation,
  bcRefreshRequest,
} from '../db/schema.js';
import type { BcClient } from './bc-client.js';

export interface SyncStats {
  [entity: string]: number;
}

type Loc = typeof location.$inferSelect;

export class BcSyncService {
  constructor(
    private readonly db: Db,
    private readonly clientFor: (companyId: string) => BcClient,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  /** Syncs all BC companies referenced by active locations. Uses an advisory lock so only one worker runs. */
  async runAll(): Promise<SyncStats> {
    // Session-level advisory locks belong to one connection: lock and unlock must use the same client,
    // otherwise the unlock silently fails and the lock is held forever by a pooled connection.
    const client = await (this.db as unknown as { $client: pg.Pool }).$client.connect();
    // A checked-out client without listener would crash the process when the server drops the connection.
    const onError = (e: Error) => this.log(`[bc-sync] lock connection lost: ${e.message}`);
    client.on('error', onError);
    let locked = false;
    try {
      const res = await client.query<{ ok: boolean }>(
        "select pg_try_advisory_lock(hashtext('bc-sync')) as ok",
      );
      locked = !!res.rows[0]?.ok;
      if (!locked) return {};
      const locs = await this.db.select().from(location).where(eq(location.active, true));
      const stats: SyncStats = {};
      for (const companyId of [...new Set(locs.map((l) => l.bcCompanyId))]) {
        const s = await this.syncCompany(
          companyId,
          locs.filter((l) => l.bcCompanyId === companyId),
        );
        for (const [k, v] of Object.entries(s)) stats[k] = (stats[k] ?? 0) + v;
      }
      return stats;
    } finally {
      if (locked) await client.query("select pg_advisory_unlock(hashtext('bc-sync'))").catch(() => undefined);
      client.off('error', onError);
      client.release();
    }
  }

  private async cursor(companyId: string, entity: string): Promise<Date | null> {
    const [c] = await this.db
      .select()
      .from(bcSyncCursor)
      .where(and(eq(bcSyncCursor.bcCompanyId, companyId), eq(bcSyncCursor.entity, entity)));
    return c?.lastModified ?? null;
  }

  private async saveCursor(
    companyId: string,
    entity: string,
    rows: Array<{ lastModifiedDateTime?: string; deletedAt?: string }>,
    error?: string,
  ) {
    const prev = await this.cursor(companyId, entity);
    const max = rows.reduce<number>(
      (m, r) => Math.max(m, Date.parse(r.lastModifiedDateTime ?? r.deletedAt ?? '')) || m,
      prev?.getTime() ?? 0,
    );
    const values = {
      bcCompanyId: companyId,
      entity,
      lastModified: max ? new Date(max) : null,
      lastRunAt: new Date(),
      lastError: error ?? null,
    };
    await this.db
      .insert(bcSyncCursor)
      .values(values)
      .onConflictDoUpdate({ target: [bcSyncCursor.bcCompanyId, bcSyncCursor.entity], set: values });
  }

  /**
   * "Aus BC aktualisieren" (E-61): re-reads requested orders with their service items and allocations right now,
   * independent of the delta cursor. Requests come from the API; the worker holds the BC credentials.
   */
  async processRefreshRequests(limit = 20): Promise<number> {
    const open = await this.db
      .select({
        id: bcRefreshRequest.id,
        bcNo: serviceOrder.bcNo,
        companyId: serviceOrder.bcCompanyId,
      })
      .from(bcRefreshRequest)
      .innerJoin(serviceOrder, eq(serviceOrder.id, bcRefreshRequest.orderId))
      .where(isNull(bcRefreshRequest.doneAt))
      .orderBy(bcRefreshRequest.requestedAt)
      .limit(limit);
    if (!open.length) return 0;
    const locs = await this.db.select().from(location).where(eq(location.active, true));
    let done = 0;
    for (const r of open) {
      const bc = this.clientFor(r.companyId);
      const no = `'${r.bcNo.replace(/'/g, "''")}'`;
      let error: string | null = null;
      try {
        const orders = await bc.list('serviceOrders', { filter: `number eq ${no}` });
        if (!orders.length) error = 'Auftrag in BC nicht gefunden';
        else {
          const companyLocs = locs.filter((l) => l.bcCompanyId === r.companyId);
          await this.applyOrders(r.companyId, companyLocs, orders);
          await this.applyOrderItems(
            r.companyId,
            await bc.list('serviceOrderItems', { filter: `documentNumber eq ${no}` }),
          );
          await this.applyAllocations(
            r.companyId,
            companyLocs,
            await bc.list('serviceOrderAllocations', { filter: `documentNumber eq ${no}` }),
          );
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        this.log(`[bc-refresh] ${r.bcNo} failed: ${error}`);
      }
      // All open requests of the same order are answered by this read.
      await this.db
        .update(bcRefreshRequest)
        .set({ doneAt: new Date(), error })
        .where(
          and(
            isNull(bcRefreshRequest.doneAt),
            inArray(
              bcRefreshRequest.id,
              open.filter((o) => o.bcNo === r.bcNo).map((o) => o.id),
            ),
          ),
        );
      done++;
    }
    return done;
  }

  async syncCompany(companyId: string, locs: Loc[]): Promise<SyncStats> {
    const bc = this.clientFor(companyId);
    const stats: SyncStats = {};
    const step = async <T extends { lastModifiedDateTime?: string; deletedAt?: string }>(
      entity: string,
      read: (since: Date | null) => Promise<T[]>,
      apply: (rows: T[]) => Promise<void>,
    ) => {
      const since = await this.cursor(companyId, entity);
      try {
        const rows = await read(since);
        await apply(rows);
        await this.saveCursor(companyId, entity, rows);
        stats[entity] = rows.length;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log(`[bc-sync] ${entity} failed: ${msg}`);
        await this.saveCursor(companyId, entity, [], msg);
      }
    };

    await step(
      'serviceOrderTypes',
      (s) => bc.listModifiedSince('serviceOrderTypes', s),
      (rows) => this.applyOrderTypes(companyId, rows),
    );
    await step(
      'customers',
      (s) => bc.listModifiedSince('customers', s),
      (rows) => this.applyCustomers(companyId, rows),
    );
    await step(
      'serviceItems',
      (s) => bc.listModifiedSince('serviceItems', s),
      (rows) => this.applyMachines(companyId, rows),
    );
    await step(
      'serviceOrders',
      (s) => bc.listModifiedSince('serviceOrders', s),
      (rows) => this.applyOrders(companyId, locs, rows),
    );
    await step(
      'serviceOrderItems',
      (s) => bc.listModifiedSince('serviceOrderItems', s),
      (rows) => this.applyOrderItems(companyId, rows),
    );
    await step(
      'serviceOrderAllocations',
      (s) => bc.listModifiedSince('serviceOrderAllocations', s),
      (rows) => this.applyAllocations(companyId, locs, rows),
    );
    await step(
      'deletedRecords',
      (s) =>
        bc.list(
          'deletedRecords',
          s ? { filter: `deletedAt gt ${new Date(s.getTime() - 5000).toISOString()}` } : {},
        ),
      (rows) => this.applyDeletions(companyId, rows),
    );
    await step(
      'postedServiceInvoices',
      (s) => bc.listModifiedSince('postedServiceInvoices', s),
      (rows) => this.applyInvoices(companyId, rows),
    );
    // Remarks and contact persons shown at the order (read only).
    await step(
      'customerComments',
      (s) => bc.listModifiedSince('customerComments', s),
      (rows) =>
        this.applyRemarks(
          companyId,
          rows.map((r) => ({ ...r, scope: 'CUSTOMER', refNo: r.customerNumber, kind: 'General' })),
        ),
    );
    await step(
      'serviceItemComments',
      (s) => bc.listModifiedSince('serviceItemComments', s),
      (rows) =>
        this.applyRemarks(
          companyId,
          rows.map((r) => ({ ...r, scope: 'SERVICE_ITEM', refNo: r.serviceItemNumber, kind: r.type })),
        ),
    );
    await step(
      'serviceCommentLines',
      (s) => bc.listModifiedSince('serviceCommentLines', s),
      // own report lines (written by the app) are not shown again as remarks
      (rows) =>
        this.applyRemarks(
          companyId,
          rows
            .filter((r) => !r.monteurAppId || r.monteurAppId === '00000000-0000-0000-0000-000000000000')
            .map((r) => ({ ...r, scope: 'ORDER', refNo: r.documentNumber, kind: r.type })),
        ),
    );
    await step(
      'customerContacts',
      (s) => bc.listModifiedSince('customerContacts', s),
      (rows) => this.applyContacts(companyId, rows),
    );
    // Material (phase 4). Posted quantities first, then inventory – keeps the "BC − pending" window small.
    await step(
      'items',
      (s) => bc.listModifiedSince('items', s),
      (rows) => this.applyItems(companyId, locs, rows),
    );
    await step(
      'serviceChecklistLines',
      (s) => bc.listModifiedSince('serviceChecklistLines', s),
      (rows) => this.applyChecklistLines(companyId, rows),
    );
    await step(
      'itemSubstitutions',
      (s) => bc.listModifiedSince('itemSubstitutions', s),
      (rows) => this.applySubstitutions(companyId, rows),
    );
    await step(
      'itemReferences',
      (s) => bc.listModifiedSince('itemReferences', s),
      (rows) => this.applyBarcodes(companyId, rows),
    );
    await step(
      'serviceLines',
      (s) => bc.listModifiedSince('serviceLines', s, 5000, "type eq 'Item'"),
      (rows) => this.applyPostedQuantities(rows),
    );
    await step(
      'itemAvailabilities',
      (s) =>
        bc.list(
          'itemAvailabilities',
          s ? { filter: `lastModifiedDateTime gt ${new Date(s.getTime() - 5000).toISOString()}` } : {},
        ),
      (rows) => this.applyAvailability(companyId, locs, rows),
    );
    return stats;
  }

  private async consumableCategories(): Promise<string[]> {
    const [row] = await this.db
      .select()
      .from(setting)
      .where(and(eq(setting.key, 'consumableCategories'), isNull(setting.locationId)));
    return (row?.value as string[] | undefined) ?? DEFAULT_CONSUMABLE_CATEGORIES;
  }

  private async applyItems(companyId: string, _locs: Loc[], rows: EntityOf<'items'>[]) {
    const consumable = await this.consumableCategories();
    for (const r of rows) {
      const v = {
        bcCompanyId: companyId,
        number: r.number,
        name: r.displayName,
        unit: r.baseUnitOfMeasureCode,
        category: r.itemCategoryCode,
        gtin: r.gtin,
        blocked: r.blocked,
        isConsumable: consumable.includes(r.itemCategoryCode),
        bcSystemId: r.id,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      await this.db
        .insert(item)
        .values(v)
        .onConflictDoUpdate({ target: [item.bcCompanyId, item.number], set: v });
    }
  }

  private async applyBarcodes(companyId: string, rows: EntityOf<'itemReferences'>[]) {
    const codes = rows.filter((r) => r.referenceType === 'Bar Code' && r.referenceNumber);
    if (!codes.length) return;
    const items = await this.db
      .select({ id: item.id, number: item.number })
      .from(item)
      .where(
        and(
          eq(item.bcCompanyId, companyId),
          inArray(item.number, [...new Set(codes.map((c) => c.itemNumber))]),
        ),
      );
    const byNo = new Map(items.map((i) => [i.number, i.id]));
    for (const c of codes) {
      const itemId = byNo.get(c.itemNumber);
      if (itemId)
        await this.db.insert(itemBarcode).values({ itemId, code: c.referenceNumber }).onConflictDoNothing();
    }
  }

  private async applyAvailability(companyId: string, locs: Loc[], rows: EntityOf<'itemAvailabilities'>[]) {
    const storages = await this.db
      .select()
      .from(storageLocation)
      .where(
        inArray(
          storageLocation.locationId,
          locs.map((l) => l.id).concat(['00000000-0000-0000-0000-000000000000']),
        ),
      );
    const byCode = new Map(storages.map((st) => [st.bcLocationCode, st.id]));
    const relevant = rows.filter((r) => byCode.has(r.locationCode));
    if (!relevant.length) return;
    const items = await this.db
      .select({ id: item.id, number: item.number })
      .from(item)
      .where(
        and(
          eq(item.bcCompanyId, companyId),
          inArray(item.number, [...new Set(relevant.map((r) => r.itemNumber))]),
        ),
      );
    const byNo = new Map(items.map((i) => [i.number, i.id]));
    for (const r of relevant) {
      const itemId = byNo.get(r.itemNumber);
      if (!itemId) continue;
      const v = {
        itemId,
        storageLocationId: byCode.get(r.locationCode)!,
        bcInventory: r.inventory,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      await this.db
        .insert(itemStock)
        .values(v)
        .onConflictDoUpdate({
          target: [itemStock.itemId, itemStock.storageLocationId],
          set: { bcInventory: v.bcInventory, bcModifiedAt: v.bcModifiedAt },
        });
    }
  }

  /**
   * Quantities posted in BC (shipment/consumption) for lines the app created. Once posted, the withdrawal is
   * part of the BC inventory and must no longer be subtracted as pending (E-16).
   */
  private async applyPostedQuantities(rows: EntityOf<'serviceLines'>[]) {
    const ours = rows.filter((r) => r.monteurAppId && r.monteurAppId !== EMPTY_GUID);
    if (!ours.length) return;
    const transfers = await this.db
      .select({ id: bcTransfer.id, payload: bcTransfer.payload })
      .from(bcTransfer)
      .where(
        inArray(
          bcTransfer.id,
          ours.map((r) => r.monteurAppId),
        ),
      );
    for (const t of transfers) {
      const line = ours.find((r) => r.monteurAppId === t.id)!;
      const ids = (t.payload as { meta?: { consumptionIds?: string[] } }).meta?.consumptionIds ?? [];
      if (ids.length !== 1) continue; // one BC line per withdrawal (E-42)
      const posted = Math.max(line.quantityShipped, line.quantityConsumed);
      await this.db.transaction(async (tx) => {
        const [c] = await tx.select().from(consumption).where(eq(consumption.id, ids[0]!)).for('update');
        if (!c || c.bcPostedQty === posted) return;
        const delta = Math.min(posted, c.quantity) - Math.min(c.bcPostedQty, c.quantity);
        await tx.update(consumption).set({ bcPostedQty: posted }).where(eq(consumption.id, c.id));
        await tx
          .update(itemStock)
          .set({ pendingWithdrawal: sql`greatest(0, ${itemStock.pendingWithdrawal} - ${delta})` })
          .where(and(eq(itemStock.itemId, c.itemId), eq(itemStock.storageLocationId, c.storageLocationId)));
      });
    }
  }

  private async applyOrderTypes(companyId: string, rows: EntityOf<'serviceOrderTypes'>[]) {
    for (const r of rows) {
      const v = {
        bcCompanyId: companyId,
        code: r.code,
        description: r.description,
        bcSystemId: r.id,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      await this.db
        .insert(orderType)
        .values(v)
        .onConflictDoUpdate({ target: [orderType.bcCompanyId, orderType.code], set: v });
    }
  }

  private async applyRemarks(
    companyId: string,
    rows: Array<{
      id: string;
      lastModifiedDateTime: string;
      scope: string;
      refNo: string;
      kind: string;
      lineNumber: number;
      date: string;
      comment: string;
    }>,
  ) {
    for (const r of rows) {
      const v = {
        bcCompanyId: companyId,
        scope: r.scope,
        refNo: r.refNo,
        kind: r.kind,
        lineNo: r.lineNumber,
        date: r.date === '0001-01-01' ? null : r.date,
        text: r.comment,
        bcSystemId: r.id,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      await this.db
        .insert(bcRemark)
        .values(v)
        .onConflictDoUpdate({
          target: [bcRemark.bcCompanyId, bcRemark.scope, bcRemark.refNo, bcRemark.kind, bcRemark.lineNo],
          set: v,
        });
    }
  }

  /** Yellow card lines: many rows per order, therefore written in batches. */
  private async applyChecklistLines(companyId: string, rows: EntityOf<'serviceChecklistLines'>[]) {
    const list = (x: string) =>
      x
        .split(';')
        .map((v) => v.trim())
        .filter(Boolean);
    const values = rows.map((r) => ({
      bcCompanyId: companyId,
      orderNo: r.documentNumber,
      lineNo: r.lineNumber,
      description: r.description,
      lineType: r.lineType,
      inputEnabled: r.inputEnabled,
      answerType: r.answerType,
      options: list(r.options),
      unit: r.unit,
      unitOptions: list(r.unitOptions),
      required: r.required,
      checked: r.checked,
      answer: r.answer,
      answerUnit: r.answerUnit,
      bcSystemId: r.id,
      bcModifiedAt: new Date(r.lastModifiedDateTime),
    }));
    const ex = (c: string) => sql.raw(`excluded.${c}`);
    for (let i = 0; i < values.length; i += 500)
      await this.db
        .insert(bcChecklistLine)
        .values(values.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [bcChecklistLine.bcCompanyId, bcChecklistLine.orderNo, bcChecklistLine.lineNo],
          set: {
            description: ex('description'),
            lineType: ex('line_type'),
            inputEnabled: ex('input_enabled'),
            answerType: ex('answer_type'),
            options: ex('options'),
            unit: ex('unit'),
            unitOptions: ex('unit_options'),
            required: ex('required'),
            checked: ex('checked'),
            answer: ex('answer'),
            answerUnit: ex('answer_unit'),
            bcSystemId: ex('bc_system_id'),
            bcModifiedAt: ex('bc_modified_at'),
          },
        });
  }

  private async applySubstitutions(companyId: string, rows: EntityOf<'itemSubstitutions'>[]) {
    for (const r of rows) {
      const v = {
        bcCompanyId: companyId,
        itemNo: r.itemNumber,
        substituteNo: r.substituteNumber,
        interchangeable: r.interchangeable,
        description: r.description,
        bcSystemId: r.id,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      await this.db
        .insert(itemSubstitution)
        .values(v)
        .onConflictDoUpdate({
          target: [itemSubstitution.bcCompanyId, itemSubstitution.itemNo, itemSubstitution.substituteNo],
          set: v,
        });
    }
  }

  private async applyContacts(companyId: string, rows: EntityOf<'customerContacts'>[]) {
    for (const r of rows) {
      const v = {
        bcCompanyId: companyId,
        number: r.number,
        customerNo: r.customerNumber,
        name: r.name,
        jobTitle: r.jobTitle,
        phone: r.phoneNumber,
        mobile: r.mobilePhoneNumber,
        email: r.email,
        bcSystemId: r.id,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      await this.db
        .insert(bcContact)
        .values(v)
        .onConflictDoUpdate({ target: [bcContact.bcCompanyId, bcContact.number], set: v });
    }
  }

  private async applyCustomers(companyId: string, rows: EntityOf<'customers'>[]) {
    for (const r of rows) {
      const v = {
        bcCompanyId: companyId,
        number: r.number,
        name: r.displayName,
        address: r.addressLine1,
        postCode: r.postalCode,
        city: r.city,
        phone: r.phoneNumber,
        bcSystemId: r.id,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      await this.db
        .insert(customer)
        .values(v)
        .onConflictDoUpdate({ target: [customer.bcCompanyId, customer.number], set: v });
    }
  }

  private async applyMachines(companyId: string, rows: EntityOf<'serviceItems'>[]) {
    for (const r of rows) {
      const v = {
        bcCompanyId: companyId,
        serviceItemNo: r.number,
        brand: r.manufacturerCode,
        model: r.description,
        serialNo: r.serialNumber,
        machineGroup: r.serviceItemGroupCode,
        // 0 = not maintained in BC (OFFENE-PUNKTE OP-20)
        operatingHours: r.operatingHours ? r.operatingHours : null,
        customerNo: r.customerNumber,
        bcSystemId: r.id,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      await this.db
        .insert(machine)
        .values(v)
        .onConflictDoUpdate({ target: [machine.bcCompanyId, machine.serviceItemNo], set: v });
    }
  }

  private async applyOrders(companyId: string, locs: Loc[], rows: EntityOf<'serviceOrders'>[]) {
    const byRc = new Map(locs.map((l) => [l.bcResponsibilityCenter, l]));
    for (const r of rows) {
      const loc = byRc.get(r.responsibilityCenter);
      if (!loc) continue; // order of a responsibility center that is not (yet) an app location
      const base = {
        locationId: loc.id,
        bcCompanyId: companyId,
        bcNo: r.number,
        description: r.description,
        orderTypeCode: r.orderType,
        bcStatus: r.status,
        priority: r.priority,
        orderDate: r.orderDate,
        responseDate: r.responseDate,
        customerNo: r.customerNumber,
        customerName: r.customerName,
        address: {
          street: r.address,
          street2: r.address2,
          postCode: r.postCode,
          city: r.city,
          country: r.countryCode,
        },
        contactName: r.contactName,
        contactPhone: r.phoneNumber,
        contactMobile: r.mobilePhoneNumber,
        bcSystemId: r.id,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      const [existing] = await this.db
        .select({ id: serviceOrder.id, appStatus: serviceOrder.appStatus, bcStatus: serviceOrder.bcStatus })
        .from(serviceOrder)
        .where(and(eq(serviceOrder.bcCompanyId, companyId), eq(serviceOrder.bcNo, r.number)));
      if (!existing) {
        await this.db.insert(serviceOrder).values({ ...base, appStatus: appStatusFromBc(r.status) });
        continue;
      }
      let appStatus: AppStatus = existing.appStatus;
      // A status change made in BC (not an echo of our own write) overrides the app status.
      if (
        existing.bcStatus !== r.status &&
        DEFAULT_STATUS_DEFINITIONS[existing.appStatus].bcStatus !== r.status &&
        existing.appStatus !== 'ABGERECHNET'
      ) {
        appStatus = appStatusFromBc(r.status as BcServiceStatus);
        await this.db.insert(orderStatusEvent).values({
          orderId: existing.id,
          fromStatus: existing.appStatus,
          toStatus: appStatus,
          source: 'BC',
          note: `BC-Status: ${r.status}`,
        });
      }
      await this.db
        .update(serviceOrder)
        .set({ ...base, appStatus, deletedInBcAt: null })
        .where(eq(serviceOrder.id, existing.id));
    }
  }

  private async orderIdsByNo(companyId: string, numbers: string[]) {
    if (!numbers.length) return new Map<string, { id: string; locationId: string }>();
    const rows = await this.db
      .select({ id: serviceOrder.id, no: serviceOrder.bcNo, locationId: serviceOrder.locationId })
      .from(serviceOrder)
      .where(and(eq(serviceOrder.bcCompanyId, companyId), inArray(serviceOrder.bcNo, numbers)));
    return new Map(rows.map((r) => [r.no, { id: r.id, locationId: r.locationId }]));
  }

  private async applyOrderItems(companyId: string, rows: EntityOf<'serviceOrderItems'>[]) {
    const orders = await this.orderIdsByNo(companyId, [...new Set(rows.map((r) => r.documentNumber))]);
    for (const r of rows) {
      const order = orders.get(r.documentNumber);
      if (!order) continue;
      const [m] = await this.db
        .select({ id: machine.id })
        .from(machine)
        .where(and(eq(machine.bcCompanyId, companyId), eq(machine.serviceItemNo, r.serviceItemNumber)));
      const v = {
        orderId: order.id,
        lineNo: r.lineNumber,
        machineId: m?.id ?? null,
        description: r.description,
        faultComment: r.faultComment,
        bcSystemId: r.id,
        bcModifiedAt: new Date(r.lastModifiedDateTime),
      };
      await this.db
        .insert(serviceOrderItem)
        .values(v)
        .onConflictDoUpdate({ target: [serviceOrderItem.orderId, serviceOrderItem.lineNo], set: v });
      if (r.lineNumber === 10000 && r.faultComment)
        await this.db
          .update(serviceOrder)
          .set({ faultDescription: r.faultComment })
          .where(eq(serviceOrder.id, order.id));
    }
  }

  private async applyAllocations(
    companyId: string,
    locs: Loc[],
    rows: EntityOf<'serviceOrderAllocations'>[],
  ) {
    const orders = await this.orderIdsByNo(companyId, [...new Set(rows.map((r) => r.documentNumber))]);
    const maps = await this.db
      .select()
      .from(bcResourceMapping)
      .where(eq(bcResourceMapping.bcCompanyId, companyId));
    const userByRes = new Map(maps.map((m) => [m.bcResourceNo, m.userId]));
    const tzByLoc = new Map(locs.map((l) => [l.id, l.timezone]));
    for (const r of rows) {
      const order = orders.get(r.documentNumber);
      const userId = userByRes.get(r.resourceNumber);
      if (!order || !userId) continue;
      const tz = tzByLoc.get(order.locationId) ?? 'Europe/Berlin';
      const start = zonedToUtc(r.allocationDate, r.startingTime, tz);
      let end = zonedToUtc(r.allocationDate, r.finishingTime, tz);
      if (end <= start) end = new Date(start.getTime() + Math.max(r.allocatedHours, 1) * 3_600_000);
      const cancelled = r.status === 'Canceled' || r.status === 'Reallocation Needed';
      const [existing] = await this.db
        .select({ id: assignment.id })
        .from(assignment)
        .where(eq(assignment.bcAllocationId, r.id));
      const v = {
        orderId: order.id,
        orderItemLineNo: r.serviceItemLineNumber,
        locationId: order.locationId,
        userId,
        plannedStart: start,
        plannedEnd: end,
        cancelledAt: cancelled ? new Date() : null,
        bcAllocationId: r.id,
      };
      if (existing) await this.db.update(assignment).set(v).where(eq(assignment.id, existing.id));
      else await this.db.insert(assignment).values(v);
    }
  }

  private async applyDeletions(companyId: string, rows: EntityOf<'deletedRecords'>[]) {
    for (const r of rows) {
      if (r.tableNumber === 5900)
        await this.db
          .update(serviceOrder)
          .set({ deletedInBcAt: new Date(r.deletedAt) })
          .where(and(eq(serviceOrder.bcCompanyId, companyId), eq(serviceOrder.bcSystemId, r.recordSystemId)));
      if (r.tableNumber === 5950)
        await this.db
          .update(assignment)
          .set({ cancelledAt: new Date(r.deletedAt) })
          .where(eq(assignment.bcAllocationId, r.recordSystemId));
    }
  }

  private async applyInvoices(companyId: string, rows: EntityOf<'postedServiceInvoices'>[]) {
    const orders = await this.orderIdsByNo(companyId, [
      ...new Set(rows.map((r) => r.orderNumber).filter(Boolean)),
    ]);
    for (const r of rows) {
      const order = orders.get(r.orderNumber);
      if (!order) continue;
      const [cur] = await this.db
        .select({ s: serviceOrder.appStatus })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, order.id));
      if (!cur || cur.s === 'ABGERECHNET') continue;
      await this.db
        .update(serviceOrder)
        .set({ appStatus: 'ABGERECHNET', billedAt: new Date(r.postingDate) })
        .where(eq(serviceOrder.id, order.id));
      await this.db.insert(orderStatusEvent).values({
        orderId: order.id,
        fromStatus: cur.s,
        toStatus: 'ABGERECHNET',
        source: 'BC',
        note: `Rechnung ${r.number}`,
      });
    }
  }
}
