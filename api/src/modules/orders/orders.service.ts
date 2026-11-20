import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { AppStatus } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db } from '../../db/client.js';
import { assignment, bcRefreshRequest, machine, serviceOrder, serviceOrderItem } from '../../db/schema.js';

export interface OrderListQuery {
  view: 'mine' | 'location';
  locationId?: string;
  status?: AppStatus[];
  from?: string;
  to?: string;
}

/**
 * Service orders. Visibility (ARCHITEKTUR 2.2):
 *  - Monteur: only orders with an active assignment to himself
 *  - Meister: all orders of his locations
 * Enforced here (query filter) and again by RLS.
 */
@Injectable()
export class OrdersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private session(scope: AccessScope) {
    return { userId: scope.userId, roles: scope.roles };
  }

  async list(scope: AccessScope, q: OrderListQuery) {
    const conds: SQL[] = [isNull(serviceOrder.deletedInBcAt)];
    if (q.view === 'location') {
      const allowed = q.locationId ? [q.locationId] : scope.meisterLocationIds;
      if (!allowed.length || !allowed.every((id) => scope.meisterLocationIds.includes(id)))
        throw new ForbiddenException('Keine Berechtigung für diesen Standort');
      conds.push(inArray(serviceOrder.locationId, allowed));
    } else {
      conds.push(
        sql`exists (select 1 from ${assignment} a where a.order_id = ${serviceOrder.id} and a.user_id = ${scope.userId} and a.cancelled_at is null)`,
      );
    }
    if (q.status?.length) conds.push(inArray(serviceOrder.appStatus, q.status));

    return withSession(this.db, this.session(scope), async (tx) => {
      const orders = await tx
        .select()
        .from(serviceOrder)
        .where(and(...conds))
        .orderBy(asc(serviceOrder.responseDate), asc(serviceOrder.bcNo))
        .limit(500);
      if (!orders.length) return [];
      const ids = orders.map((o) => o.id);
      const assignConds: SQL[] = [inArray(assignment.orderId, ids), isNull(assignment.cancelledAt)];
      if (q.view === 'mine') assignConds.push(eq(assignment.userId, scope.userId));
      if (q.from) assignConds.push(gte(assignment.plannedEnd, new Date(q.from)));
      if (q.to) assignConds.push(lte(assignment.plannedStart, new Date(q.to)));
      const [items, assigns] = await Promise.all([
        tx
          .select({ orderId: serviceOrderItem.orderId, machine })
          .from(serviceOrderItem)
          .leftJoin(machine, eq(machine.id, serviceOrderItem.machineId))
          .where(inArray(serviceOrderItem.orderId, ids)),
        tx
          .select()
          .from(assignment)
          .where(and(...assignConds)),
      ]);
      const filtered =
        q.from || q.to ? orders.filter((o) => assigns.some((a) => a.orderId === o.id)) : orders;
      return filtered.map((o) => ({
        ...o,
        machines: items.filter((i) => i.orderId === o.id).map((i) => i.machine),
        assignments: assigns.filter((a) => a.orderId === o.id),
      }));
    });
  }

  /** "Aus BC aktualisieren": queues a re-read of this order by the worker (E-61). Idempotent while one is open. */
  async requestRefresh(scope: AccessScope, id: string) {
    return withSession(this.db, { userId: scope.userId, roles: scope.roles }, async (tx) => {
      const [o] = await tx.select({ id: serviceOrder.id }).from(serviceOrder).where(eq(serviceOrder.id, id));
      if (!o) throw new NotFoundException('Auftrag nicht gefunden');
      const [open] = await tx
        .select({ requestedAt: bcRefreshRequest.requestedAt })
        .from(bcRefreshRequest)
        .where(
          and(
            eq(bcRefreshRequest.orderId, id),
            eq(bcRefreshRequest.requestedBy, scope.userId),
            isNull(bcRefreshRequest.doneAt),
          ),
        );
      if (open) return { requestedAt: open.requestedAt, alreadyRequested: true };
      const [r] = await tx
        .insert(bcRefreshRequest)
        .values({ orderId: id, requestedBy: scope.userId })
        .returning({ requestedAt: bcRefreshRequest.requestedAt });
      return { requestedAt: r!.requestedAt, alreadyRequested: false };
    });
  }

  async get(scope: AccessScope, id: string) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, id));
      // RLS hides foreign orders; a Monteur additionally needs an assignment or own time on the order.
      if (!order) throw new NotFoundException('Auftrag nicht gefunden');
      const isMeister =
        scope.meisterLocationIds.includes(order.locationId) ||
        scope.lagerLocationIds.includes(order.locationId);
      const assigns = await tx
        .select()
        .from(assignment)
        .where(
          and(
            eq(assignment.orderId, id),
            isNull(assignment.cancelledAt),
            ...(isMeister ? [] : [eq(assignment.userId, scope.userId)]),
          ),
        );
      const items = await tx
        .select({ item: serviceOrderItem, machine })
        .from(serviceOrderItem)
        .leftJoin(machine, eq(machine.id, serviceOrderItem.machineId))
        .where(eq(serviceOrderItem.orderId, id));
      return { ...order, items: items.map((i) => ({ ...i.item, machine: i.machine })), assignments: assigns };
    });
  }
}
