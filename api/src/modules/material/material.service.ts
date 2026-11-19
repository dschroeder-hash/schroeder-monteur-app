import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  availableQuantity,
  belowMinimum,
  canTransition,
  estimateDelivery,
  meterPlausible,
  normalizePartNo,
  type Bundesland,
  type CommandPayload,
} from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import type { Tx } from '../../db/client.js';
import {
  consumption,
  container,
  item,
  itemBarcode,
  itemStock,
  location,
  orderStatusEvent,
  partRequest,
  serviceOrder,
  setting,
  storageLocation,
  userLocation,
} from '../../db/schema.js';
import { notify } from '../notifications.js';
import { CommandRejected } from '../sync/command-rejected.js';

type Loc = typeof location.$inferSelect;

/**
 * Parts and consumables (PROMPT 5.4/5.5). Withdrawals reduce the available stock immediately
 * (pending_withdrawal, E-16) and are approved by the Meister before they go to BC.
 * pending_withdrawal is maintained incrementally under a row lock, because a Monteur must not be able
 * to read other people's withdrawals (RLS); the worker reconciles it from all rows.
 */
@Injectable()
export class MaterialService {
  async loc(tx: Tx, locationId: string): Promise<Loc> {
    const [l] = await tx.select().from(location).where(eq(location.id, locationId));
    return l!;
  }

  /** Adds `delta` to pending withdrawals and returns available quantity before/after and the minimum. */
  async adjustPending(tx: Tx, itemId: string, storageId: string, delta: number) {
    await tx.insert(itemStock).values({ itemId, storageLocationId: storageId }).onConflictDoNothing();
    const [before] = await tx
      .select()
      .from(itemStock)
      .where(and(eq(itemStock.itemId, itemId), eq(itemStock.storageLocationId, storageId)))
      .for('update');
    const [after] = await tx
      .update(itemStock)
      .set({ pendingWithdrawal: sql`${itemStock.pendingWithdrawal} + ${delta}` })
      .where(and(eq(itemStock.itemId, itemId), eq(itemStock.storageLocationId, storageId)))
      .returning();
    return {
      before: availableQuantity(before!.bcInventory, before!.pendingWithdrawal),
      after: availableQuantity(after!.bcInventory, after!.pendingWithdrawal),
      minStock: after!.minStock,
    };
  }

  async notifyRoles(
    tx: Tx,
    locationId: string,
    roles: Array<'MEISTER' | 'LAGER'>,
    kind: string,
    title: string,
    body: string,
    link?: string,
  ) {
    const users = await tx
      .selectDistinct({ userId: userLocation.userId })
      .from(userLocation)
      .where(and(eq(userLocation.locationId, locationId), inArray(userLocation.role, roles)));
    for (const u of users) await notify(tx, u.userId, kind, title, body, link);
  }

  async consume(
    tx: Tx,
    scope: AccessScope,
    locationId: string,
    id: string,
    deviceTime: Date,
    p: CommandPayload<'ConsumeItem'>,
    orderAccess: (orderId: string) => Promise<'assigned' | 'former' | 'none'>,
  ): Promise<string[]> {
    const warnings: string[] = [];
    const [it] = await tx.select().from(item).where(eq(item.id, p.itemId));
    if (!it || it.blocked) throw new CommandRejected('Artikel nicht gefunden oder gesperrt');
    const [storage] = await tx
      .select()
      .from(storageLocation)
      .where(eq(storageLocation.id, p.storageLocationId));
    if (!storage || storage.locationId !== locationId)
      throw new CommandRejected('Lagerort gehört nicht zu Ihrem Standort');
    let cont: typeof container.$inferSelect | undefined;
    if (p.containerId) {
      [cont] = await tx.select().from(container).where(eq(container.id, p.containerId));
      if (!cont || cont.locationId !== locationId || cont.itemId !== p.itemId)
        throw new CommandRejected('Gebinde passt nicht zum Artikel');
    }
    if (p.orderId) {
      const access = await orderAccess(p.orderId);
      if (access === 'none') throw new CommandRejected('Auftrag nicht gefunden oder nicht zugewiesen');
      if (access === 'former')
        warnings.push(
          'Der Auftrag ist Ihnen nicht mehr zugewiesen – die Entnahme wurde trotzdem gespeichert.',
        );
    }
    if (!meterPlausible(p.quantity, p.meterBefore, p.meterAfter))
      warnings.push('Zählerstände passen nicht zur Menge – bitte prüfen. Ihr Meister sieht den Hinweis.');

    const stock = await this.adjustPending(tx, p.itemId, p.storageLocationId, p.quantity);
    const conflict = stock.after < 0;
    await tx.insert(consumption).values({
      id,
      userId: scope.userId,
      locationId,
      orderId: p.orderId ?? null,
      itemId: p.itemId,
      storageLocationId: p.storageLocationId,
      containerId: p.containerId ?? null,
      quantity: p.quantity,
      unit: it.unit,
      costCenter: p.costCenter ?? null,
      internalPurpose: p.internalPurpose ?? null,
      meterBefore: p.meterBefore ?? null,
      meterAfter: p.meterAfter ?? null,
      deviceTime,
      stockConflict: conflict,
    });

    // Stock conflicts are resolved on the server and reported to the Meister (ARCHITEKTUR 4.3) – never rejected.
    if (conflict)
      await this.notifyRoles(
        tx,
        locationId,
        ['MEISTER', 'LAGER'],
        'STOCK_CONFLICT',
        'Bestandskonflikt',
        `${it.name}: Entnahme ${p.quantity} ${it.unit} bei Bestand ${stock.before} (${storage.name})`,
        '/lager',
      );
    const min = cont?.minStock ?? stock.minStock;
    if (belowMinimum(stock.after, min) && !belowMinimum(stock.before, min))
      await this.notifyRoles(
        tx,
        locationId,
        ['MEISTER', 'LAGER'],
        'MIN_STOCK',
        'Mindestbestand unterschritten',
        `${cont?.name ?? it.name}: noch ${stock.after} ${it.unit} (Minimum ${min})`,
        '/lager',
      );
    return warnings;
  }

  async removeConsumption(tx: Tx, scope: AccessScope, consumptionId: string) {
    const [c] = await tx
      .select()
      .from(consumption)
      .where(and(eq(consumption.id, consumptionId), eq(consumption.userId, scope.userId)))
      .for('update');
    if (!c) throw new CommandRejected('Entnahme nicht gefunden');
    if (c.state !== 'SUBMITTED')
      throw new CommandRejected('Entnahme ist bereits freigegeben und kann nicht mehr storniert werden');
    await tx.update(consumption).set({ state: 'REJECTED' }).where(eq(consumption.id, c.id));
    await this.adjustPending(tx, c.itemId, c.storageLocationId, -c.quantity);
  }

  async requestPart(
    tx: Tx,
    scope: AccessScope,
    locationId: string,
    id: string,
    deviceTime: Date,
    p: CommandPayload<'RequestPart'>,
    orderAccess: (orderId: string) => Promise<'assigned' | 'former' | 'none'>,
  ): Promise<string[]> {
    if ((await orderAccess(p.orderId)) === 'none')
      throw new CommandRejected('Auftrag nicht gefunden oder nicht zugewiesen');
    const loc = await this.loc(tx, locationId);
    const cutoff = await this.setting<{ time: string }>(tx, locationId, 'partsCutoff', { time: '17:00' });
    const est = estimateDelivery(deviceTime, loc.timezone, loc.bundesland as Bundesland, cutoff.time);
    const [it] = p.itemId ? await tx.select().from(item).where(eq(item.id, p.itemId)) : [];
    if (p.itemId && !it) throw new CommandRejected('Artikel nicht gefunden');
    await tx.insert(partRequest).values({
      id,
      orderId: p.orderId,
      requestedBy: scope.userId,
      locationId,
      itemId: p.itemId ?? null,
      newItemText: p.newItemText ?? null,
      manufacturerPartNo: p.manufacturerPartNo ?? null,
      quantity: p.quantity,
      sourceBcLocationCode: p.sourceBcLocationCode ?? null,
      expectedDelivery: est.deliveryDate,
    });
    const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, p.orderId));
    if (
      p.setWaitingForParts &&
      order &&
      order.appStatus !== 'WARTET_TEILE' &&
      canTransition(order.appStatus, 'WARTET_TEILE', 'MONTEUR')
    ) {
      await tx.update(serviceOrder).set({ appStatus: 'WARTET_TEILE' }).where(eq(serviceOrder.id, order.id));
      await tx
        .insert(orderStatusEvent)
        .values({
          orderId: order.id,
          fromStatus: order.appStatus,
          toStatus: 'WARTET_TEILE',
          actorId: scope.userId,
          source: 'BESTELLUNG',
          deviceTime,
        });
    }
    const what = it ? `${it.number} ${it.name}` : `Neuer Artikel: ${p.newItemText}`;
    await this.notifyRoles(
      tx,
      locationId,
      ['LAGER'],
      'PART_REQUEST',
      p.itemId ? 'Bestellanforderung' : 'Neuer Artikel – Anfrage',
      `${order?.bcNo ?? ''}: ${p.quantity} × ${what} – Lieferung ${est.label}`,
      '/lager',
    );
    return [
      est.afterCutoff
        ? `Bestellschluss ${cutoff.time} Uhr ist vorbei – Lieferung voraussichtlich ${est.label}.`
        : `Bestellt vor ${cutoff.time} Uhr – Lieferung voraussichtlich ${est.label}.`,
    ];
  }

  async setting<T>(tx: Tx, locationId: string, key: string, fallback: T): Promise<T> {
    const rows = await tx
      .select()
      .from(setting)
      .where(and(eq(setting.key, key), or(isNull(setting.locationId), eq(setting.locationId, locationId))));
    return ((rows.find((r) => r.locationId === locationId) ?? rows[0])?.value as T) ?? fallback;
  }

  /**
   * Item search (number prefix, name, barcode/EAN) with stock: own location (incl. service vans) in detail,
   * other locations aggregated per warehouse (online only).
   */
  async search(tx: Tx, locationIds: string[], q: { text?: string; code?: string }, limit = 30) {
    const conds = [eq(item.blocked, false)];
    if (q.code) {
      const code = q.code.trim();
      conds.push(
        or(
          eq(item.gtin, code),
          sql`exists (select 1 from ${itemBarcode} b where b.item_id = item.id and b.code = ${code})`,
          sql`regexp_replace(upper(${item.number}), '[^A-Z0-9]', '', 'g') = ${normalizePartNo(code)}`,
        )!,
      );
    } else if (q.text) {
      const t = q.text.trim();
      const norm = normalizePartNo(t);
      conds.push(
        or(
          ilike(item.name, `%${t}%`),
          sql`regexp_replace(upper(${item.number}), '[^A-Z0-9]', '', 'g') like ${`${norm}%`}`,
          eq(item.gtin, t),
        )!,
      );
    }
    const items = await tx
      .select()
      .from(item)
      .where(and(...conds))
      .orderBy(asc(item.number))
      .limit(limit);
    if (!items.length) return [];
    const stocks = await tx
      .select({
        s: itemStock,
        storage: storageLocation,
        locationName: location.name,
        locationCode: location.code,
      })
      .from(itemStock)
      .innerJoin(storageLocation, eq(storageLocation.id, itemStock.storageLocationId))
      .innerJoin(location, eq(location.id, storageLocation.locationId))
      .where(
        inArray(
          itemStock.itemId,
          items.map((i) => i.id),
        ),
      );
    return items.map((i) => {
      const own = stocks.filter((s) => s.s.itemId === i.id && locationIds.includes(s.storage.locationId));
      const other = stocks.filter(
        (s) =>
          s.s.itemId === i.id && !locationIds.includes(s.storage.locationId) && s.storage.kind === 'LAGER',
      );
      return {
        ...i,
        stock: own.map((s) => ({
          storageLocationId: s.storage.id,
          name: s.storage.name,
          kind: s.storage.kind,
          bcLocationCode: s.storage.bcLocationCode,
          available: availableQuantity(s.s.bcInventory, s.s.pendingWithdrawal),
          minStock: s.s.minStock,
        })),
        otherLocations: other
          .map((s) => ({
            locationCode: s.locationCode,
            name: s.locationName,
            bcLocationCode: s.storage.bcLocationCode,
            available: availableQuantity(s.s.bcInventory, s.s.pendingWithdrawal),
          }))
          .filter((s) => s.available > 0),
      };
    });
  }
}
