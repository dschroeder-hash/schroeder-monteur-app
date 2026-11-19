import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  addDays,
  canTransition,
  DEFAULT_STATUS_DEFINITIONS,
  localDate,
  summarizeDay,
  zonedToUtc,
  type Activity,
  type AppStatus,
  type Segment,
  type StampKind,
} from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db, type Tx } from '../../db/client.js';
import {
  appUser,
  approval,
  bcResourceMapping,
  location,
  orderStatusEvent,
  overheadType,
  serviceOrder,
  setting,
  stampEvent,
  stampEventVoid,
  timeCorrectionRequest,
  timeEntry,
  userLocation,
} from '../../db/schema.js';
import { notify } from '../notifications.js';
import { TimeService } from '../time/time.service.js';
import { TransferService } from '../transfer/transfer.service.js';

export interface CorrectionEvent {
  kind: StampKind;
  /** local wall-clock time HH:mm on the work date */
  time: string;
  orderId?: string | null;
  activity?: Activity | null;
  overheadCode?: string | null;
}

/** Work type codes per activity (OFFENE-PUNKTE OP-16, setting `workTypes`). */
const DEFAULT_WORK_TYPES: Record<Activity, string> = {
  WORK: 'ARBEIT',
  TRAVEL: 'FAHRT',
  DIAGNOSIS: 'DIAGNOSE',
};

type Entry = typeof timeEntry.$inferSelect;

function toSegments(entries: Entry[]): Segment[] {
  return entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    start: e.startAt.toISOString(),
    end: e.endAt?.toISOString() ?? null,
    orderId: e.orderId,
    activity: e.activity,
    overheadCode: e.overheadCode,
    workDate: e.workDate,
  }));
}

/**
 * Approval inbox for the Meister (PROMPT 5.3/5.1): approve working days per Monteur, decide correction requests,
 * correct times (always with reason + audit log), approve orders. Approvals enqueue the BC transfers in the same
 * transaction (E-09); nothing is posted in BC.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TimeService) private readonly time: TimeService,
    @Inject(TransferService) private readonly transfers: TransferService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private session(s: AccessScope) {
    return { userId: s.userId, roles: s.roles };
  }

  /** Location of a Monteur that the Meister is responsible for – otherwise 404 (no information leak). */
  private async monteurLocation(tx: Tx, scope: AccessScope, userId: string) {
    const rows = await tx
      .select({ locationId: userLocation.locationId })
      .from(userLocation)
      .where(and(eq(userLocation.userId, userId), eq(userLocation.role, 'MONTEUR')));
    const loc = rows.find((r) => scope.meisterLocationIds.includes(r.locationId));
    if (!loc) throw new NotFoundException('Monteur nicht gefunden');
    const [l] = await tx.select().from(location).where(eq(location.id, loc.locationId));
    return l!;
  }

  async inbox(scope: AccessScope, locationId: string) {
    if (!scope.meisterLocationIds.includes(locationId))
      throw new ForbiddenException('Keine Berechtigung für diesen Standort');
    return withSession(this.db, this.session(scope), async (tx) => {
      const [loc] = await tx.select().from(location).where(eq(location.id, locationId));
      const today = localDate(new Date(), loc!.timezone);
      const entries = await tx
        .select()
        .from(timeEntry)
        .where(
          and(
            eq(timeEntry.locationId, locationId),
            eq(timeEntry.state, 'OPEN'),
            gte(timeEntry.workDate, addDays(today, -60)),
          ),
        )
        .orderBy(asc(timeEntry.workDate), asc(timeEntry.startAt));
      const users = await tx
        .select({ id: appUser.id, name: appUser.displayName })
        .from(appUser)
        .where(inArray(appUser.id, [...new Set(entries.map((e) => e.userId)), scope.userId]));
      const orders = await tx
        .select({ id: serviceOrder.id, bcNo: serviceOrder.bcNo, customerName: serviceOrder.customerName })
        .from(serviceOrder)
        .where(
          inArray(
            serviceOrder.id,
            [...new Set(entries.map((e) => e.orderId).filter((x): x is string => !!x))].concat([
              '00000000-0000-0000-0000-000000000000',
            ]),
          ),
        );

      const groups = new Map<string, Entry[]>();
      for (const e of entries)
        groups.set(`${e.userId}|${e.workDate}`, [...(groups.get(`${e.userId}|${e.workDate}`) ?? []), e]);
      const days = [...groups.entries()].map(([k, list]) => {
        const [userId, workDate] = k.split('|') as [string, string];
        const summary = summarizeDay(workDate, toSegments(list));
        const running = list.some((e) => e.endAt === null);
        return {
          userId,
          userName: users.find((u) => u.id === userId)?.name ?? '',
          workDate,
          summary,
          needsCorrection: list.some((e) => e.needsCorrection),
          skewFlag: list.some((e) => e.skewFlag),
          running,
          approvable: !running && workDate <= today && !list.some((e) => e.needsCorrection),
          orders: summary.byOrder.map((o) => ({ ...o, ...orders.find((x) => x.id === o.orderId) })),
        };
      });

      const corrections = await tx
        .select({ r: timeCorrectionRequest, userName: appUser.displayName })
        .from(timeCorrectionRequest)
        .innerJoin(appUser, eq(appUser.id, timeCorrectionRequest.userId))
        .where(
          and(eq(timeCorrectionRequest.locationId, locationId), eq(timeCorrectionRequest.state, 'OFFEN')),
        )
        .orderBy(asc(timeCorrectionRequest.workDate));

      const ordersToApprove = await tx
        .select({
          id: serviceOrder.id,
          bcNo: serviceOrder.bcNo,
          customerName: serviceOrder.customerName,
          description: serviceOrder.description,
          updatedAt: serviceOrder.updatedAt,
        })
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.locationId, locationId),
            eq(serviceOrder.appStatus, 'FERTIG'),
            isNull(serviceOrder.deletedInBcAt),
          ),
        )
        .orderBy(asc(serviceOrder.updatedAt));

      return {
        days,
        corrections: corrections.map((c) => ({ ...c.r, userName: c.userName })),
        orders: ordersToApprove,
        // filled in phase 4 (material) and phase 6 (vacation)
        consumptions: [],
        vacations: [],
      };
    });
  }

  async approveDay(scope: AccessScope, userId: string, workDate: string) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const loc = await this.monteurLocation(tx, scope, userId);
      const entries = await tx
        .select()
        .from(timeEntry)
        .where(and(eq(timeEntry.userId, userId), eq(timeEntry.workDate, workDate)))
        .for('update');
      if (!entries.length) throw new NotFoundException('Keine Zeiten für diesen Tag');
      const open = entries.filter((e) => e.state === 'OPEN');
      if (!open.length) throw new ConflictException('Dieser Tag ist bereits freigegeben');
      if (open.some((e) => e.endAt === null))
        throw new UnprocessableEntityException('Der Tag ist noch nicht abgeschlossen (laufende Buchung)');
      if (open.some((e) => e.needsCorrection))
        throw new UnprocessableEntityException('Ausstempeln fehlt – bitte zuerst korrigieren');

      const [mapping] = await tx.select().from(bcResourceMapping).where(eq(bcResourceMapping.userId, userId));
      if (!mapping)
        throw new UnprocessableEntityException('Keine BC-Ressource für diesen Monteur hinterlegt');

      const [ap] = await tx
        .insert(approval)
        .values({
          subjectType: 'time_day',
          subjectId: randomUUID(),
          decision: 'APPROVED',
          approvedBy: scope.userId,
        })
        .returning();
      await tx
        .update(timeEntry)
        .set({ state: 'APPROVED', approvalId: ap!.id })
        .where(
          inArray(
            timeEntry.id,
            open.map((e) => e.id),
          ),
        );

      const cfg = await this.settings(tx, loc.id);
      const orders = await tx
        .select({ id: serviceOrder.id, bcNo: serviceOrder.bcNo })
        .from(serviceOrder)
        .where(
          inArray(
            serviceOrder.id,
            [...new Set(open.map((e) => e.orderId).filter((x): x is string => !!x))].concat([
              '00000000-0000-0000-0000-000000000000',
            ]),
          ),
        );

      // Order times: one BC line per order × activity with the billable (rounded) hours of the day.
      const byOrder = new Map<string, Entry[]>();
      for (const e of open.filter((x) => x.kind === 'ORDER' && x.orderId))
        byOrder.set(`${e.orderId}|${e.activity}`, [...(byOrder.get(`${e.orderId}|${e.activity}`) ?? []), e]);
      let lines = 0;
      for (const [key, list] of byOrder) {
        const [orderId, activity] = key.split('|') as [string, Activity];
        const minutes = list.reduce((s, e) => s + (e.billableMinutes ?? 0), 0);
        if (minutes <= 0) continue;
        const order = orders.find((o) => o.id === orderId)!;
        const hours = Math.round((minutes / 60) * 100) / 100;
        const workTypeCode = cfg.workTypes[activity];
        const meta = { timeEntryIds: list.map((e) => e.id), approvalId: ap!.id };
        if (cfg.timeTarget === 'resource_journal')
          await this.transfers.enqueue(tx, {
            locationId: loc.id,
            bcCompanyId: loc.bcCompanyId,
            target: 'RESOURCE_JOURNAL',
            subjectType: 'time_group',
            subjectId: ap!.id,
            groupKey: `order:${orderId}`,
            payload: {
              op: 'create',
              endpoint: 'resourceJournalLines',
              body: {
                ...cfg.journal,
                postingDate: workDate,
                documentNumber: order.bcNo,
                resourceNumber: mapping.bcResourceNo,
                workTypeCode,
                description: `${order.bcNo} ${activity}`,
                quantity: hours,
                unitOfMeasureCode: 'STUNDE',
              },
              meta,
            },
          });
        else
          await this.transfers.enqueue(tx, {
            locationId: loc.id,
            bcCompanyId: loc.bcCompanyId,
            target: 'SERVICE_LINE_RESOURCE',
            subjectType: 'time_group',
            subjectId: ap!.id,
            groupKey: `order:${orderId}`,
            payload: {
              op: 'create',
              endpoint: 'serviceLines',
              body: {
                documentNumber: order.bcNo,
                serviceItemLineNumber: 10000,
                type: 'Resource',
                number: mapping.bcResourceNo,
                quantity: hours,
                unitOfMeasureCode: 'STUNDE',
                locationCode: '',
                workTypeCode,
              },
              meta,
            },
          });
        lines++;
      }

      // Overhead times go to the resource journal (no order).
      const overheads = await tx.select().from(overheadType);
      const byOverhead = new Map<string, Entry[]>();
      for (const e of open.filter((x) => x.kind === 'OVERHEAD' && x.overheadCode))
        byOverhead.set(e.overheadCode!, [...(byOverhead.get(e.overheadCode!) ?? []), e]);
      for (const [code, list] of byOverhead) {
        const minutes = list.reduce((s, e) => s + (e.actualMinutes ?? 0), 0);
        if (minutes <= 0) continue;
        await this.transfers.enqueue(tx, {
          locationId: loc.id,
          bcCompanyId: loc.bcCompanyId,
          target: 'RESOURCE_JOURNAL',
          subjectType: 'time_group',
          subjectId: ap!.id,
          groupKey: `overhead:${userId}:${workDate}`,
          payload: {
            op: 'create',
            endpoint: 'resourceJournalLines',
            body: {
              ...cfg.journal,
              postingDate: workDate,
              documentNumber: `GK-${workDate}`,
              resourceNumber: mapping.bcResourceNo,
              workTypeCode: code,
              description: overheads.find((o) => o.code === code)?.label ?? code,
              quantity: Math.round((minutes / 60) * 100) / 100,
              unitOfMeasureCode: 'STUNDE',
            },
            meta: { timeEntryIds: list.map((e) => e.id), approvalId: ap!.id },
          },
        });
        lines++;
      }

      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'APPROVE_TIME_DAY',
        entity: 'time_day',
        entityId: `${userId}:${workDate}`,
        newValue: {
          approvalId: ap!.id,
          entries: open.length,
          bcLines: lines,
          summary: summarizeDay(workDate, toSegments(open)),
        },
      });
      return { approvalId: ap!.id, entries: open.length, bcLines: lines };
    });
  }

  private async settings(tx: Tx, locationId: string) {
    const rows = await tx
      .select()
      .from(setting)
      .where(
        and(
          inArray(setting.key, ['timeTarget', 'workTypes', 'resourceJournal']),
          or(isNull(setting.locationId), eq(setting.locationId, locationId)),
        ),
      );
    const get = <T>(k: string, d: T): T =>
      ((rows.find((r) => r.key === k && r.locationId === locationId) ?? rows.find((r) => r.key === k))
        ?.value as T) ?? d;
    return {
      timeTarget: get<'service_line' | 'resource_journal'>('timeTarget', 'service_line'),
      workTypes: { ...DEFAULT_WORK_TYPES, ...get<Partial<Record<Activity, string>>>('workTypes', {}) },
      journal: get('resourceJournal', { journalTemplateName: 'RESSOURCE', journalBatchName: 'MONTEUR' }),
    };
  }

  /** Meister correction: void wrong events and/or add events – always with reason, never editing raw data (E-37). */
  async correct(
    scope: AccessScope,
    input: {
      userId: string;
      workDate: string;
      voidEventIds: string[];
      addEvents: CorrectionEvent[];
      reason: string;
    },
  ) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const loc = await this.monteurLocation(tx, scope, input.userId);
      await this.applyCorrection(tx, scope, loc, input);
      return { ok: true };
    });
  }

  private async applyCorrection(
    tx: Tx,
    scope: AccessScope,
    loc: typeof location.$inferSelect,
    input: {
      userId: string;
      workDate: string;
      voidEventIds: string[];
      addEvents: CorrectionEvent[];
      reason: string;
    },
  ) {
    if (!input.voidEventIds.length && !input.addEvents.length)
      throw new UnprocessableEntityException('Keine Änderung angegeben');
    const locked = await tx
      .select({ id: timeEntry.id })
      .from(timeEntry)
      .where(
        and(
          eq(timeEntry.userId, input.userId),
          eq(timeEntry.workDate, input.workDate),
          sql`${timeEntry.state} <> 'OPEN'`,
        ),
      )
      .limit(1);
    if (locked.length)
      throw new ConflictException('Der Tag ist bereits freigegeben und kann nicht mehr korrigiert werden');

    const before = await tx
      .select()
      .from(timeEntry)
      .where(and(eq(timeEntry.userId, input.userId), eq(timeEntry.workDate, input.workDate)));
    const dayStart = zonedToUtc(input.workDate, '00:00', loc.timezone);
    const dayEnd = zonedToUtc(addDays(input.workDate, 1), '00:00', loc.timezone);

    if (input.voidEventIds.length) {
      const evs = await tx
        .select()
        .from(stampEvent)
        .where(and(inArray(stampEvent.id, input.voidEventIds), eq(stampEvent.userId, input.userId)));
      if (evs.length !== input.voidEventIds.length)
        throw new NotFoundException('Stempelereignis nicht gefunden');
      await tx
        .insert(stampEventVoid)
        .values(
          evs.map((e) => ({
            eventId: e.id,
            userId: input.userId,
            voidedBy: scope.userId,
            reason: input.reason,
          })),
        )
        .onConflictDoNothing();
    }
    for (const ev of input.addEvents) {
      const at = zonedToUtc(input.workDate, ev.time, loc.timezone);
      if (at < dayStart || at >= dayEnd)
        throw new UnprocessableEntityException('Zeit liegt nicht am gewählten Tag');
      if (at.getTime() > Date.now()) throw new UnprocessableEntityException('Zeit liegt in der Zukunft');
      await tx.insert(stampEvent).values({
        id: randomUUID(),
        userId: input.userId,
        kind: ev.kind,
        orderId: ev.orderId ?? null,
        activity: ev.activity ?? null,
        overheadCode: ev.overheadCode ?? null,
        deviceTime: at,
        createdBy: scope.userId,
        correctionReason: input.reason,
      });
    }
    await this.time.recompute(tx, input.userId, loc.id, dayStart);
    // Recompute only touches the day and the previous day; make sure "today" of the corrected day is covered.
    await this.time.recompute(tx, input.userId, loc.id, new Date(dayEnd.getTime() - 1));
    const after = await tx
      .select()
      .from(timeEntry)
      .where(and(eq(timeEntry.userId, input.userId), eq(timeEntry.workDate, input.workDate)));
    await this.audit.log(tx, {
      actorId: scope.userId,
      action: 'CORRECT_TIME',
      entity: 'time_day',
      entityId: `${input.userId}:${input.workDate}`,
      oldValue: { summary: summarizeDay(input.workDate, toSegments(before)) },
      newValue: {
        summary: summarizeDay(input.workDate, toSegments(after)),
        voided: input.voidEventIds,
        added: input.addEvents,
      },
      reason: input.reason,
    });
    await notify(
      tx,
      input.userId,
      'TIME_CORRECTED',
      'Zeiten korrigiert',
      `Ihr Meister hat Ihre Zeiten vom ${input.workDate} korrigiert: ${input.reason}`,
      '/monteur/zeiten',
    );
  }

  async decideCorrection(
    scope: AccessScope,
    id: string,
    decision: 'ANGENOMMEN' | 'ABGELEHNT',
    reason: string,
  ) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const [req] = await tx
        .select()
        .from(timeCorrectionRequest)
        .where(eq(timeCorrectionRequest.id, id))
        .for('update');
      if (!req || !scope.meisterLocationIds.includes(req.locationId))
        throw new NotFoundException('Korrekturantrag nicht gefunden');
      if (req.state !== 'OFFEN') throw new ConflictException('Antrag wurde bereits entschieden');
      if (decision === 'ANGENOMMEN') {
        const [loc] = await tx.select().from(location).where(eq(location.id, req.locationId));
        await this.applyCorrection(tx, scope, loc!, {
          userId: req.userId,
          workDate: req.workDate,
          voidEventIds: [],
          addEvents: req.proposal as CorrectionEvent[],
          reason: `Korrekturantrag angenommen${reason ? `: ${reason}` : ''}`,
        });
      } else {
        await notify(
          tx,
          req.userId,
          'TIME_CORRECTION_REJECTED',
          'Korrekturantrag abgelehnt',
          reason || 'Bitte mit dem Meister klären',
          '/monteur/zeiten',
        );
        await this.audit.log(tx, {
          actorId: scope.userId,
          action: 'REJECT_CORRECTION',
          entity: 'time_correction_request',
          entityId: id,
          oldValue: req,
          reason,
        });
      }
      await tx
        .update(timeCorrectionRequest)
        .set({
          state: decision,
          decidedBy: scope.userId,
          decidedAt: new Date(),
          decisionReason: reason || null,
        })
        .where(eq(timeCorrectionRequest.id, id));
      return { ok: true };
    });
  }

  /** Raw events of a Monteur's day for the correction dialog. */
  async dayEvents(scope: AccessScope, userId: string, workDate: string) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const loc = await this.monteurLocation(tx, scope, userId);
      const from = zonedToUtc(workDate, '00:00', loc.timezone);
      const to = zonedToUtc(addDays(workDate, 1), '00:00', loc.timezone);
      const events = await tx
        .select({
          e: stampEvent,
          voided: sql<boolean>`exists (select 1 from ${stampEventVoid} v where v.event_id = ${stampEvent.id})`,
        })
        .from(stampEvent)
        .where(
          and(eq(stampEvent.userId, userId), gte(stampEvent.deviceTime, from), lt(stampEvent.deviceTime, to)),
        )
        .orderBy(asc(stampEvent.deviceTime));
      return events.map((r) => ({ ...r.e, voided: r.voided }));
    });
  }

  /** Meister status change incl. approval (FREIGEGEBEN → BC status Finished via transfer, E-14). */
  async setOrderStatus(scope: AccessScope, orderId: string, status: AppStatus, note?: string) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, orderId)).for('update');
      if (!order || !scope.meisterLocationIds.includes(order.locationId))
        throw new NotFoundException('Auftrag nicht gefunden');
      if (order.appStatus === status) return order;
      if (!canTransition(order.appStatus, status, 'MEISTER'))
        throw new UnprocessableEntityException('Dieser Statuswechsel ist nicht erlaubt');
      if (status === 'FREIGEGEBEN' && order.appStatus !== 'FERTIG')
        throw new UnprocessableEntityException(
          'Freigeben ist erst möglich, wenn der Auftrag auf „Fertig“ steht',
        );
      const [updated] = await tx
        .update(serviceOrder)
        .set({ appStatus: status })
        .where(eq(serviceOrder.id, orderId))
        .returning();
      await tx.insert(orderStatusEvent).values({
        orderId,
        fromStatus: order.appStatus,
        toStatus: status,
        actorId: scope.userId,
        source: 'MEISTER',
        note: note ?? null,
      });
      const def = DEFAULT_STATUS_DEFINITIONS[status];
      if (def.writeToBc && def.bcStatus)
        await this.transfers.enqueue(tx, {
          locationId: order.locationId,
          bcCompanyId: order.bcCompanyId,
          target: 'STATUS',
          subjectType: 'service_order',
          subjectId: orderId,
          groupKey: `order:${orderId}`,
          payload: {
            op: 'patch',
            endpoint: 'serviceOrders',
            ref: { table: 'service_order', id: orderId },
            body: { status: def.bcStatus },
          },
        });
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'SET_STATUS',
        entity: 'service_order',
        entityId: orderId,
        oldValue: { appStatus: order.appStatus },
        newValue: { appStatus: status },
        reason: note,
      });
      return updated;
    });
  }
}
