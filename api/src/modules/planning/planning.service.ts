import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { localDate, localTime } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db, type Tx } from '../../db/client.js';
import {
  absence,
  appUser,
  assignment,
  bcResourceMapping,
  location,
  machine,
  orderStatusEvent,
  serviceOrder,
  serviceOrderItem,
  userLocation,
} from '../../db/schema.js';
import { AuditService } from '../../common/audit.service.js';
import { notify } from '../notifications.js';
import { TransferService } from '../transfer/transfer.service.js';

export type ConflictKind = 'DOUBLE_BOOKING' | 'ABSENCE';
export interface Conflict {
  kind: ConflictKind;
  message: string;
  otherAssignmentId?: string;
}

const MAX_DURATION_MS = 16 * 3_600_000;

/**
 * Planning board (PROMPT 5.2). Meister of the location only. Every change is written to BC as a
 * Service Order Allocation via the transfer queue (E-13: a Meister action counts as approved).
 */
@Injectable()
export class PlanningService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TransferService) private readonly transfers: TransferService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private session(s: AccessScope) {
    return { userId: s.userId, roles: s.roles };
  }

  private requireMeister(scope: AccessScope, locationId: string) {
    if (!scope.meisterLocationIds.includes(locationId))
      throw new ForbiddenException('Keine Berechtigung für diesen Standort');
  }

  async board(scope: AccessScope, locationId: string, from: Date, to: Date) {
    this.requireMeister(scope, locationId);
    if (to <= from || to.getTime() - from.getTime() > 31 * 86_400_000)
      throw new BadRequestException('Zeitraum ungültig (max. 31 Tage)');
    return withSession(this.db, this.session(scope), async (tx) => {
      const [loc] = await tx.select().from(location).where(eq(location.id, locationId));
      const monteure = await tx
        .select({
          id: appUser.id,
          name: appUser.displayName,
          isApprentice: appUser.isApprentice,
          resourceNo: bcResourceMapping.bcResourceNo,
        })
        .from(userLocation)
        .innerJoin(appUser, eq(appUser.id, userLocation.userId))
        .leftJoin(bcResourceMapping, eq(bcResourceMapping.userId, appUser.id))
        .where(
          and(
            eq(userLocation.locationId, locationId),
            eq(userLocation.role, 'MONTEUR'),
            eq(appUser.active, true),
          ),
        )
        .orderBy(asc(appUser.displayName));
      const assigns = await tx
        .select({
          a: assignment,
          bcNo: serviceOrder.bcNo,
          customerName: serviceOrder.customerName,
          appStatus: serviceOrder.appStatus,
          orderTypeCode: serviceOrder.orderTypeCode,
        })
        .from(assignment)
        .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
        .where(
          and(
            eq(assignment.locationId, locationId),
            isNull(assignment.cancelledAt),
            lt(assignment.plannedStart, to),
            gt(assignment.plannedEnd, from),
          ),
        )
        .orderBy(asc(assignment.plannedStart));
      // Absences are shown without reason on the board (only "abwesend") – PROMPT 5.10.
      const absences = await tx
        .select({
          id: absence.id,
          userId: absence.userId,
          fromDate: absence.fromDate,
          toDate: absence.toDate,
          halfDay: absence.halfDay,
          state: absence.state,
        })
        .from(absence)
        .where(
          and(
            eq(absence.locationId, locationId),
            inArray(absence.state, ['REPORTED', 'APPROVED', 'REQUESTED']),
            sql`${absence.fromDate} <= ${localDate(to, loc!.timezone)}`,
            sql`coalesce(${absence.toDate}, ${absence.fromDate}) >= ${localDate(from, loc!.timezone)}`,
          ),
        );
      const unplanned = await tx
        .select({
          id: serviceOrder.id,
          bcNo: serviceOrder.bcNo,
          customerName: serviceOrder.customerName,
          description: serviceOrder.description,
          faultDescription: serviceOrder.faultDescription,
          orderTypeCode: serviceOrder.orderTypeCode,
          priority: serviceOrder.priority,
          responseDate: serviceOrder.responseDate,
          appStatus: serviceOrder.appStatus,
          machine: sql<
            string | null
          >`(select m.model from ${serviceOrderItem} i join ${machine} m on m.id = i.machine_id where i.order_id = service_order.id order by i.line_no limit 1)`,
          needsReplan: sql<boolean>`exists (select 1 from ${assignment} x where x.order_id = service_order.id and x.needs_replan and x.cancelled_at is null)`,
        })
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.locationId, locationId),
            isNull(serviceOrder.deletedInBcAt),
            or(
              eq(serviceOrder.appStatus, 'NEU'),
              sql`exists (select 1 from ${assignment} x where x.order_id = ${serviceOrder.id} and x.needs_replan and x.cancelled_at is null)`,
            ),
          ),
        )
        .orderBy(asc(serviceOrder.responseDate), asc(serviceOrder.bcNo))
        .limit(300);

      const list = assigns.map((r) => ({
        ...r.a,
        bcNo: r.bcNo,
        customerName: r.customerName,
        appStatus: r.appStatus,
        orderTypeCode: r.orderTypeCode,
      }));
      return {
        location: loc,
        monteure,
        assignments: list.map((a) => ({
          ...a,
          conflicts: this.conflictsFor(a, list, absences, loc!.timezone),
        })),
        absences: absences.map(({ state: _s, ...a }) => a),
        unplanned,
      };
    });
  }

  private conflictsFor(
    a: { id: string; userId: string; plannedStart: Date; plannedEnd: Date },
    all: Array<{ id: string; userId: string; plannedStart: Date; plannedEnd: Date; bcNo: string }>,
    absences: Array<{ userId: string; fromDate: string; toDate: string | null }>,
    tz: string,
  ): Conflict[] {
    const out: Conflict[] = [];
    for (const b of all)
      if (
        b.id !== a.id &&
        b.userId === a.userId &&
        b.plannedStart < a.plannedEnd &&
        b.plannedEnd > a.plannedStart
      )
        out.push({
          kind: 'DOUBLE_BOOKING',
          message: `Überschneidung mit ${b.bcNo}`,
          otherAssignmentId: b.id,
        });
    const d1 = localDate(a.plannedStart, tz);
    const d2 = localDate(new Date(a.plannedEnd.getTime() - 1), tz);
    for (const ab of absences)
      if (ab.userId === a.userId && ab.fromDate <= d2 && (ab.toDate ?? ab.fromDate) >= d1)
        out.push({ kind: 'ABSENCE', message: 'Monteur ist abwesend' });
    return out;
  }

  private async conflictsInDb(
    tx: Tx,
    locationId: string,
    tz: string,
    a: { id: string; userId: string; plannedStart: Date; plannedEnd: Date },
  ) {
    const others = await tx
      .select({
        id: assignment.id,
        userId: assignment.userId,
        plannedStart: assignment.plannedStart,
        plannedEnd: assignment.plannedEnd,
        bcNo: serviceOrder.bcNo,
      })
      .from(assignment)
      .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
      .where(
        and(
          eq(assignment.userId, a.userId),
          isNull(assignment.cancelledAt),
          ne(assignment.id, a.id),
          lt(assignment.plannedStart, a.plannedEnd),
          gt(assignment.plannedEnd, a.plannedStart),
        ),
      );
    const abs = await tx
      .select({ userId: absence.userId, fromDate: absence.fromDate, toDate: absence.toDate })
      .from(absence)
      .where(
        and(
          eq(absence.userId, a.userId),
          eq(absence.locationId, locationId),
          notInArray(absence.state, ['REJECTED', 'CANCELLED']),
        ),
      );
    return this.conflictsFor(a, [...others, a as typeof a & { bcNo: string }], abs, tz);
  }

  private validateTimes(start: Date, end: Date) {
    if (!(end > start)) throw new BadRequestException('Ende muss nach dem Beginn liegen');
    if (end.getTime() - start.getTime() > MAX_DURATION_MS)
      throw new BadRequestException('Eine Einplanung darf höchstens 16 Stunden dauern');
  }

  private async monteurOf(tx: Tx, userId: string, locationId: string) {
    const [m] = await tx
      .select({ id: appUser.id, name: appUser.displayName, resourceNo: bcResourceMapping.bcResourceNo })
      .from(userLocation)
      .innerJoin(appUser, eq(appUser.id, userLocation.userId))
      .leftJoin(bcResourceMapping, eq(bcResourceMapping.userId, appUser.id))
      .where(
        and(
          eq(userLocation.userId, userId),
          eq(userLocation.locationId, locationId),
          eq(userLocation.role, 'MONTEUR'),
        ),
      );
    if (!m) throw new UnprocessableEntityException('Monteur gehört nicht zu diesem Standort');
    if (!m.resourceNo)
      throw new UnprocessableEntityException(
        `Für ${m.name} ist keine BC-Ressource hinterlegt (Administration)`,
      );
    return m as { id: string; name: string; resourceNo: string };
  }

  private allocationBody(tz: string, resourceNo: string, start: Date, end: Date) {
    return {
      resourceNumber: resourceNo,
      allocationDate: localDate(start, tz),
      startingTime: `${localTime(start, tz)}:00`,
      finishingTime: `${localTime(end, tz)}:00`,
      allocatedHours: Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 100) / 100,
    };
  }

  async create(
    scope: AccessScope,
    input: { orderId: string; userId: string; plannedStart: Date; plannedEnd: Date },
  ) {
    this.validateTimes(input.plannedStart, input.plannedEnd);
    return withSession(this.db, this.session(scope), async (tx) => {
      const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, input.orderId));
      if (!order || !scope.meisterLocationIds.includes(order.locationId))
        throw new NotFoundException('Auftrag nicht gefunden');
      if (order.appStatus === 'FREIGEGEBEN' || order.appStatus === 'ABGERECHNET')
        throw new UnprocessableEntityException('Auftrag ist bereits abgeschlossen');
      const [loc] = await tx.select().from(location).where(eq(location.id, order.locationId));
      const m = await this.monteurOf(tx, input.userId, order.locationId);
      const [a] = await tx
        .insert(assignment)
        .values({
          orderId: order.id,
          locationId: order.locationId,
          userId: m.id,
          plannedStart: input.plannedStart,
          plannedEnd: input.plannedEnd,
          createdBy: scope.userId,
        })
        .returning();
      // An order being replanned is no longer flagged once it has a new assignment.
      await tx
        .update(assignment)
        .set({ needsReplan: false })
        .where(and(eq(assignment.orderId, order.id), eq(assignment.needsReplan, true)));
      if (order.appStatus === 'NEU') {
        await tx.update(serviceOrder).set({ appStatus: 'EINGEPLANT' }).where(eq(serviceOrder.id, order.id));
        await tx.insert(orderStatusEvent).values({
          orderId: order.id,
          fromStatus: 'NEU',
          toStatus: 'EINGEPLANT',
          actorId: scope.userId,
          source: 'PLANTAFEL',
        });
      }
      await this.transfers.enqueue(tx, {
        locationId: order.locationId,
        bcCompanyId: order.bcCompanyId,
        target: 'ALLOCATION',
        subjectType: 'assignment',
        subjectId: a!.id,
        groupKey: `assignment:${a!.id}`,
        payload: {
          op: 'create',
          endpoint: 'serviceOrderAllocations',
          body: {
            documentNumber: order.bcNo,
            serviceItemLineNumber: a!.orderItemLineNo,
            ...this.allocationBody(loc!.timezone, m.resourceNo, a!.plannedStart, a!.plannedEnd),
          },
        },
      });
      await notify(
        tx,
        m.id,
        'ASSIGNMENT',
        'Neuer Auftrag eingeplant',
        `${order.bcNo} · ${order.customerName} · ${localDate(a!.plannedStart, loc!.timezone)} ${localTime(a!.plannedStart, loc!.timezone)} Uhr`,
        `/monteur/auftrag?id=${order.id}`,
      );
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'ASSIGN',
        entity: 'assignment',
        entityId: a!.id,
        newValue: a,
      });
      return { ...a!, conflicts: await this.conflictsInDb(tx, order.locationId, loc!.timezone, a!) };
    });
  }

  async move(
    scope: AccessScope,
    id: string,
    input: { userId?: string; plannedStart: Date; plannedEnd: Date },
  ) {
    this.validateTimes(input.plannedStart, input.plannedEnd);
    return withSession(this.db, this.session(scope), async (tx) => {
      const [old] = await tx
        .select()
        .from(assignment)
        .where(and(eq(assignment.id, id), isNull(assignment.cancelledAt)));
      if (!old || !scope.meisterLocationIds.includes(old.locationId))
        throw new NotFoundException('Einplanung nicht gefunden');
      const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, old.orderId));
      const [loc] = await tx.select().from(location).where(eq(location.id, old.locationId));
      const m = await this.monteurOf(tx, input.userId ?? old.userId, old.locationId);
      const [a] = await tx
        .update(assignment)
        .set({
          userId: m.id,
          plannedStart: input.plannedStart,
          plannedEnd: input.plannedEnd,
          needsReplan: false,
        })
        .where(eq(assignment.id, id))
        .returning();
      await this.transfers.enqueue(tx, {
        locationId: old.locationId,
        bcCompanyId: order!.bcCompanyId,
        target: 'ALLOCATION',
        subjectType: 'assignment',
        subjectId: id,
        groupKey: `assignment:${id}`,
        payload: {
          op: 'patch',
          endpoint: 'serviceOrderAllocations',
          ref: { table: 'assignment', id },
          body: this.allocationBody(loc!.timezone, m.resourceNo, a!.plannedStart, a!.plannedEnd),
        },
      });
      const when = `${localDate(a!.plannedStart, loc!.timezone)} ${localTime(a!.plannedStart, loc!.timezone)} Uhr`;
      if (old.userId !== m.id) {
        await notify(
          tx,
          old.userId,
          'ASSIGNMENT',
          'Einplanung entfernt',
          `${order!.bcNo} wurde einem Kollegen zugewiesen`,
        );
        await notify(
          tx,
          m.id,
          'ASSIGNMENT',
          'Neuer Auftrag eingeplant',
          `${order!.bcNo} · ${order!.customerName} · ${when}`,
          `/monteur/auftrag?id=${order!.id}`,
        );
      } else
        await notify(
          tx,
          m.id,
          'ASSIGNMENT',
          'Einplanung geändert',
          `${order!.bcNo} · neu: ${when}`,
          `/monteur/auftrag?id=${order!.id}`,
        );
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'MOVE',
        entity: 'assignment',
        entityId: id,
        oldValue: old,
        newValue: a,
      });
      return { ...a!, conflicts: await this.conflictsInDb(tx, old.locationId, loc!.timezone, a!) };
    });
  }

  async cancel(scope: AccessScope, id: string) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const [old] = await tx
        .select()
        .from(assignment)
        .where(and(eq(assignment.id, id), isNull(assignment.cancelledAt)));
      if (!old || !scope.meisterLocationIds.includes(old.locationId))
        throw new NotFoundException('Einplanung nicht gefunden');
      const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, old.orderId));
      await tx.update(assignment).set({ cancelledAt: new Date() }).where(eq(assignment.id, id));
      const remaining = await tx
        .select({ id: assignment.id })
        .from(assignment)
        .where(and(eq(assignment.orderId, old.orderId), isNull(assignment.cancelledAt)));
      if (!remaining.length && order!.appStatus === 'EINGEPLANT') {
        await tx.update(serviceOrder).set({ appStatus: 'NEU' }).where(eq(serviceOrder.id, order!.id));
        await tx.insert(orderStatusEvent).values({
          orderId: order!.id,
          fromStatus: 'EINGEPLANT',
          toStatus: 'NEU',
          actorId: scope.userId,
          source: 'PLANTAFEL',
        });
      }
      await this.transfers.enqueue(tx, {
        locationId: old.locationId,
        bcCompanyId: order!.bcCompanyId,
        target: 'ALLOCATION',
        subjectType: 'assignment',
        subjectId: id,
        groupKey: `assignment:${id}`,
        payload: {
          op: 'patch',
          endpoint: 'serviceOrderAllocations',
          ref: { table: 'assignment', id },
          body: { status: 'Canceled' },
        },
      });
      await notify(
        tx,
        old.userId,
        'ASSIGNMENT',
        'Einplanung entfernt',
        `${order!.bcNo} · ${order!.customerName}`,
      );
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'UNASSIGN',
        entity: 'assignment',
        entityId: id,
        oldValue: old,
      });
      return { ok: true };
    });
  }
}
