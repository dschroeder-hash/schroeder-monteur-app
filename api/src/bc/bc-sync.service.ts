/**
 * BC → app delta sync (ARCHITEKTUR 5.4). Runs in the worker with the monteur_worker DB role.
 * Each entity keeps its own cursor (max lastModifiedDateTime seen); reads overlap by 5 s and upsert,
 * so repeated or overlapping runs are harmless.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  appStatusFromBc,
  DEFAULT_STATUS_DEFINITIONS,
  zonedToUtc,
  type AppStatus,
  type BcServiceStatus,
} from '@schroeder/shared';
import type { EntityOf } from '@schroeder/bc-contract';
import type { Db } from '../db/client.js';
import {
  assignment,
  bcResourceMapping,
  bcSyncCursor,
  customer,
  location,
  machine,
  orderStatusEvent,
  orderType,
  serviceOrder,
  serviceOrderItem,
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
    const locks = await this.db.execute(sql`select pg_try_advisory_lock(hashtext('bc-sync')) as ok`);
    if (!(locks.rows[0] as { ok: boolean }).ok) return {};
    try {
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
      await this.db.execute(sql`select pg_advisory_unlock(hashtext('bc-sync'))`);
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
    return stats;
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
