import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import {
  canTransition,
  CLOCK_SKEW_THRESHOLD_MS,
  COMMAND_PAYLOADS,
  STAMP_COMMAND_KIND,
  type AppStatus,
  type Feature,
  type CommandPayload,
  type CommandResult,
  type CommandType,
  type PushRequest,
  type PushResponse,
  type SyncCommand,
} from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db, type Tx } from '../../db/client.js';
import {
  absence,
  appUser,
  assignment,
  chatMessage,
  chatRead,
  consumption,
  container,
  item,
  itemBarcode,
  itemStock,
  location,
  machine,
  orderStatusEvent,
  overheadType,
  partRequest,
  photo,
  serviceOrder,
  serviceOrderItem,
  setting,
  stampEvent,
  stampEventVoid,
  storageLocation,
  syncCommand,
  textTemplate,
  checklistTemplate,
  orderChecklist,
  orderSignature,
  timeCorrectionRequest,
  timeEntry,
  userLocation,
  vacationBalance,
  workReport,
} from '../../db/schema.js';
import { notify } from '../notifications.js';
import { FeatureService } from '../../features/feature.service.js';
import { TimeService } from '../time/time.service.js';
import { MaterialService } from '../material/material.service.js';
import { ReportService } from '../docs/report.service.js';
import { CommService } from '../files/comm.service.js';
import { AbsenceService } from '../absence/absence.service.js';

import { CommandRejected } from './command-rejected.js';
export { CommandRejected };

/** Statuses that are moved to "In Arbeit" / "Unterwegs" automatically when stamping starts. */
const AUTO_WORK_FROM: AppStatus[] = [
  'NEU',
  'EINGEPLANT',
  'UNTERWEGS',
  'WARTET_TEILE',
  'WARTET_KUNDE',
  'FERTIG_DOKU_OFFEN',
];
const AUTO_TRAVEL_FROM: AppStatus[] = ['NEU', 'EINGEPLANT'];

const XID8 = /^\d{1,20}$/;
const HISTORY_DAYS = 35;

@Injectable()
export class SyncService {
  private readonly log = new Logger('Sync');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TimeService) private readonly time: TimeService,
    @Inject(FeatureService) private readonly features: FeatureService,
    @Inject(MaterialService) private readonly material: MaterialService,
    @Inject(ReportService) private readonly report: ReportService,
    @Inject(CommService) private readonly comm: CommService,
    @Inject(AbsenceService) private readonly absences: AbsenceService,
  ) {}

  private session(s: AccessScope) {
    return { userId: s.userId, roles: s.roles };
  }

  private homeLocation(s: AccessScope): string {
    const id = s.monteurLocationIds[0];
    if (!id) throw new ForbiddenException('Kein Standort als Monteur zugeordnet');
    return id;
  }

  // -------------------------------------------------------------------------
  // Push
  // -------------------------------------------------------------------------

  async push(scope: AccessScope, req: PushRequest): Promise<PushResponse> {
    const locationId = this.homeLocation(scope);
    const clockSkewMs = Date.now() - Date.parse(req.deviceNow);
    const skewFlagged = Math.abs(clockSkewMs) > CLOCK_SKEW_THRESHOLD_MS;
    // All flags are read BEFORE any transaction: a flag lookup inside a transaction needs a second pool connection,
    // and under load (all connections held by waiting transactions) that deadlocks the pool (found in the load test).
    const flags = await this.features.effective([locationId]);
    const stampingEnabled = flags.stamping;
    const results: CommandResult[] = [];

    // Device order is authoritative (chat order, stamp order).
    const commands = [...req.commands].sort((a, b) => a.deviceSeq - b.deviceSeq);
    for (const cmd of commands) {
      try {
        const r = await withSession(this.db, this.session(scope), async (tx) => {
          const inserted = await tx
            .insert(syncCommand)
            .values({
              id: cmd.id,
              userId: scope.userId,
              deviceId: req.deviceId,
              deviceSeq: cmd.deviceSeq,
              type: cmd.type,
              deviceTime: new Date(cmd.deviceTime),
              result: 'applied',
            })
            .onConflictDoNothing()
            .returning({ id: syncCommand.id });
          if (!inserted.length) return { id: cmd.id, result: 'duplicate' as const };
          const warnings = await this.apply(tx, scope, locationId, cmd, {
            stampingEnabled,
            clockSkewMs,
            skewFlagged,
            flags,
          });
          return { id: cmd.id, result: 'applied' as const, ...(warnings.length ? { warnings } : {}) };
        });
        results.push(r);
      } catch (e) {
        if (!(e instanceof CommandRejected)) {
          this.log.error(`command ${cmd.id} (${cmd.type}) failed`, e instanceof Error ? e.stack : String(e));
          // Unknown errors are not persisted as rejected: the client retries later.
          results.push({
            id: cmd.id,
            result: 'rejected',
            reason: 'Vorübergehender Fehler – wird erneut versucht',
          });
          break; // keep device order: stop processing further commands of this batch
        }
        await withSession(this.db, this.session(scope), (tx) =>
          tx
            .insert(syncCommand)
            .values({
              id: cmd.id,
              userId: scope.userId,
              deviceId: req.deviceId,
              deviceSeq: cmd.deviceSeq,
              type: cmd.type,
              deviceTime: new Date(cmd.deviceTime),
              result: 'rejected',
              resultDetail: { reason: e.message },
            })
            .onConflictDoNothing(),
        );
        results.push({ id: cmd.id, result: 'rejected', reason: e.message });
      }
    }
    return { results, clockSkewMs, skewFlagged };
  }

  private async apply(
    tx: Tx,
    scope: AccessScope,
    locationId: string,
    cmd: SyncCommand,
    ctx: {
      stampingEnabled: boolean;
      clockSkewMs: number;
      skewFlagged: boolean;
      flags: Record<Feature, boolean>;
    },
  ): Promise<string[]> {
    const schema = COMMAND_PAYLOADS[cmd.type as CommandType];
    const parsed = schema.safeParse(cmd.payload ?? {});
    if (!parsed.success) throw new CommandRejected('Ungültige Daten im Befehl');
    const payload = parsed.data as Record<string, unknown>;
    const warnings: string[] = [];

    if (cmd.type in STAMP_COMMAND_KIND) {
      if (!ctx.stampingEnabled)
        throw new CommandRejected('Stempelung ist für Ihren Standort nicht freigeschaltet');
      const kind = STAMP_COMMAND_KIND[cmd.type as keyof typeof STAMP_COMMAND_KIND];
      const orderId = (payload.orderId as string | undefined) ?? null;
      if (orderId) {
        const access = await this.orderAccess(tx, scope, orderId);
        if (access === 'none') throw new CommandRejected('Auftrag nicht gefunden oder nicht zugewiesen');
        if (access === 'former')
          warnings.push(
            'Der Auftrag ist Ihnen inzwischen nicht mehr zugewiesen. Die Zeit wurde trotzdem gespeichert; Ihr Meister wird informiert.',
          );
      }
      const deviceTime = new Date(cmd.deviceTime);
      if (deviceTime.getTime() > Date.now() + CLOCK_SKEW_THRESHOLD_MS + Math.max(0, -ctx.clockSkewMs))
        throw new CommandRejected('Zeitpunkt liegt in der Zukunft – bitte Geräteuhr prüfen');
      await tx.insert(stampEvent).values({
        id: cmd.id,
        userId: scope.userId,
        kind,
        orderId,
        activity: (payload.activity as 'WORK' | 'TRAVEL' | 'DIAGNOSIS' | undefined) ?? null,
        overheadCode: (payload.overheadCode as string | undefined) ?? null,
        deviceTime,
        clockSkewMs: ctx.clockSkewMs,
        skewFlag: ctx.skewFlagged,
        deviceId: null,
      });
      const r = await this.time.recompute(tx, scope.userId, locationId, deviceTime);
      if (r.lockedDates.length)
        warnings.push(
          'Für diesen Tag wurden die Zeiten bereits eingereicht. Die Buchung wird dem Meister zur Prüfung vorgelegt.',
        );

      // Status automation (PROMPT 5.3): stamping start → In Arbeit / Unterwegs. Stamp times win (ARCHITEKTUR 4.3).
      if (kind === 'JOB_START' && orderId) {
        const travel = payload.activity === 'TRAVEL';
        await this.autoStatus(
          tx,
          scope,
          orderId,
          travel ? 'UNTERWEGS' : 'IN_ARBEIT',
          travel ? AUTO_TRAVEL_FROM : AUTO_WORK_FROM,
          deviceTime,
        );
      }
      return warnings;
    }

    if (cmd.type === 'SetOrderStatus') {
      const { orderId, status, note } = payload as { orderId: string; status: AppStatus; note?: string };
      if ((await this.orderAccess(tx, scope, orderId)) !== 'assigned')
        throw new CommandRejected('Auftrag nicht gefunden oder nicht zugewiesen');
      const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, orderId));
      if (!order) throw new CommandRejected('Auftrag nicht gefunden');
      let target = status;
      // "Fertig" requires complete documentation – otherwise "Fertig – Doku offen" (PROMPT 5.3/5.6).
      if (status === 'FERTIG') {
        const c = await this.report.completeness(tx, orderId);
        if (!c.complete) {
          target = 'FERTIG_DOKU_OFFEN';
          warnings.push(
            `Dokumentation unvollständig (${c.missing.join(', ')}) – Status „Fertig – Doku offen“.`,
          );
        }
      }
      if (order.appStatus === target) return warnings;
      if (!canTransition(order.appStatus, target, 'MONTEUR'))
        throw new CommandRejected(
          `Statuswechsel von „${order.appStatus}“ nach „${target}“ ist nicht erlaubt`,
        );
      await this.setStatus(
        tx,
        scope,
        order.id,
        order.appStatus,
        target,
        'MONTEUR',
        new Date(cmd.deviceTime),
        note,
      );
      return warnings;
    }

    if (cmd.type === 'ConsumeItem' || cmd.type === 'RemoveConsumption' || cmd.type === 'RequestPart') {
      const p = payload as Record<string, unknown>;
      const feature = cmd.type === 'ConsumeItem' && p.containerId ? 'consumables' : 'materials';
      if (!ctx.flags[feature])
        throw new CommandRejected('Dieses Modul ist für Ihren Standort nicht freigeschaltet');
      const access = (orderId: string) => this.orderAccess(tx, scope, orderId);
      if (cmd.type === 'ConsumeItem')
        return this.material.consume(
          tx,
          scope,
          locationId,
          cmd.id,
          new Date(cmd.deviceTime),
          payload as CommandPayload<'ConsumeItem'>,
          access,
        );
      if (cmd.type === 'RequestPart')
        return this.material.requestPart(
          tx,
          scope,
          locationId,
          cmd.id,
          new Date(cmd.deviceTime),
          payload as CommandPayload<'RequestPart'>,
          access,
        );
      await this.material.removeConsumption(tx, scope, (payload as { consumptionId: string }).consumptionId);
      return warnings;
    }

    if (cmd.type === 'SaveChecklist')
      return this.report.saveChecklist(
        tx,
        scope,
        new Date(cmd.deviceTime),
        payload as CommandPayload<'SaveChecklist'>,
        (id) => this.orderAccess(tx, scope, id),
      );
    if (cmd.type === 'SignOrder')
      return this.report.sign(
        tx,
        scope,
        new Date(cmd.deviceTime),
        payload as CommandPayload<'SignOrder'>,
        (id) => this.orderAccess(tx, scope, id),
      );

    if (cmd.type === 'SaveWorkReport')
      return this.report.save(
        tx,
        scope,
        new Date(cmd.deviceTime),
        payload as CommandPayload<'SaveWorkReport'>,
        (id) => this.orderAccess(tx, scope, id),
      );

    if (cmd.type === 'AttachPhoto') {
      if (!ctx.flags['photos'])
        throw new CommandRejected('Fotos sind für Ihren Standort nicht freigeschaltet');
      await this.comm.attachPhoto(tx, scope, cmd.id, payload as CommandPayload<'AttachPhoto'>, (id) =>
        this.orderAccess(tx, scope, id),
      );
      return warnings;
    }

    if (cmd.type === 'SendChatMessage' || cmd.type === 'MarkChatRead') {
      if (!ctx.flags['chat'])
        throw new CommandRejected('Der Chat ist für Ihren Standort nicht freigeschaltet');
      const p = payload as {
        orderId: string;
        body?: string;
        photoId?: string | null;
        upToServerSeq?: number;
      };
      if ((await this.orderAccess(tx, scope, p.orderId)) === 'none')
        throw new CommandRejected('Auftrag nicht gefunden oder nicht zugewiesen');
      if (cmd.type === 'MarkChatRead') await this.comm.markRead(tx, scope, p.orderId, p.upToServerSeq ?? 0);
      else
        await this.comm.sendMessage(
          tx,
          scope,
          cmd.id,
          cmd.deviceSeq,
          new Date(cmd.deviceTime),
          { orderId: p.orderId, body: p.body ?? '', photoId: p.photoId },
          null,
        );
      return warnings;
    }

    if (cmd.type === 'ReportSick' || cmd.type === 'UpdateSickEnd') {
      if (!ctx.flags['absence.sick'])
        throw new CommandRejected('Die Krankmeldung ist für Ihren Standort nicht freigeschaltet');
      if (cmd.type === 'ReportSick')
        return this.absences.reportSick(
          tx,
          scope,
          locationId,
          cmd.id,
          payload as CommandPayload<'ReportSick'>,
        );
      return this.absences.updateSickEndByMonteur(tx, scope, payload as CommandPayload<'UpdateSickEnd'>);
    }

    if (cmd.type === 'RequestVacation' || cmd.type === 'WithdrawVacation') {
      if (!ctx.flags['absence.vacation'])
        throw new CommandRejected('Urlaubsanträge sind für Ihren Standort nicht freigeschaltet');
      if (cmd.type === 'RequestVacation')
        return this.absences.requestVacation(
          tx,
          scope,
          locationId,
          cmd.id,
          payload as CommandPayload<'RequestVacation'>,
        );
      return this.absences.withdrawVacation(tx, scope, payload as CommandPayload<'WithdrawVacation'>);
    }

    if (cmd.type === 'RequestTimeCorrection') {
      const p = payload as {
        workDate: string;
        proposal: Array<{ kind: string; time: string }>;
        comment?: string;
      };
      await tx.insert(timeCorrectionRequest).values({
        id: cmd.id,
        userId: scope.userId,
        locationId,
        workDate: p.workDate,
        proposal: p.proposal,
        comment: p.comment ?? null,
      });
      const meister = await tx
        .select({ userId: userLocation.userId })
        .from(userLocation)
        .where(and(eq(userLocation.locationId, locationId), eq(userLocation.role, 'MEISTER')));
      for (const m of meister)
        await notify(
          tx,
          m.userId,
          'CORRECTION_REQUEST',
          'Korrekturantrag',
          `Zeitkorrektur für ${p.workDate} beantragt`,
          '/meister/freigaben',
        );
      return warnings;
    }

    throw new CommandRejected('Unbekannter Befehl');
  }

  /** 'assigned' = active assignment; 'former' = had an assignment or own time (reassigned while offline). */
  private async orderAccess(
    tx: Tx,
    scope: AccessScope,
    orderId: string,
  ): Promise<'assigned' | 'former' | 'none'> {
    const rows = await tx
      .select({ cancelledAt: assignment.cancelledAt })
      .from(assignment)
      .where(and(eq(assignment.orderId, orderId), eq(assignment.userId, scope.userId)));
    if (rows.some((r) => r.cancelledAt === null)) return 'assigned';
    if (rows.length) return 'former';
    const own = await tx
      .select({ id: timeEntry.id })
      .from(timeEntry)
      .where(and(eq(timeEntry.orderId, orderId), eq(timeEntry.userId, scope.userId)))
      .limit(1);
    return own.length ? 'former' : 'none';
  }

  private async autoStatus(
    tx: Tx,
    scope: AccessScope,
    orderId: string,
    to: AppStatus,
    from: AppStatus[],
    at: Date,
  ) {
    const [order] = await tx
      .select({ s: serviceOrder.appStatus })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, orderId));
    if (!order || order.s === to || !from.includes(order.s)) return;
    await this.setStatus(tx, scope, orderId, order.s, to, 'STEMPELUNG', at);
  }

  private async setStatus(
    tx: Tx,
    scope: AccessScope,
    orderId: string,
    from: AppStatus,
    to: AppStatus,
    source: string,
    at: Date,
    note?: string,
  ) {
    await tx.update(serviceOrder).set({ appStatus: to }).where(eq(serviceOrder.id, orderId));
    await tx.insert(orderStatusEvent).values({
      orderId,
      fromStatus: from,
      toStatus: to,
      actorId: scope.userId,
      source,
      note: note ?? null,
      deviceTime: at,
    });
  }

  // -------------------------------------------------------------------------
  // Pull
  // -------------------------------------------------------------------------

  async pull(scope: AccessScope, cursor: string | null) {
    if (cursor !== null && !XID8.test(cursor)) throw new ForbiddenException('Ungültiger Cursor');
    const locationId = this.homeLocation(scope);
    return withSession(
      this.db,
      this.session(scope),
      async (tx) => {
        // Taken first: fixes the snapshot of this REPEATABLE READ transaction.
        const [{ next }] = (
          await tx.execute(sql`select pg_snapshot_xmin(pg_current_snapshot())::text as next`)
        ).rows as [{ next: string }];
        const since = (col: unknown) => (cursor === null ? sql`true` : sql`${col} >= ${cursor}::xid8`);
        const historyFrom = new Date(Date.now() - HISTORY_DAYS * 86_400_000);

        const assignments = await tx
          .select()
          .from(assignment)
          .where(
            and(
              eq(assignment.userId, scope.userId),
              since(assignment.txId),
              cursor === null ? isNull(assignment.cancelledAt) : sql`true`,
            ),
          );

        // Orders: visible via RLS (assigned or own time). Initial pull skips long-finished orders.
        const orderConds = [since(serviceOrder.txId)];
        if (cursor === null)
          orderConds.push(
            or(
              notInArray(serviceOrder.appStatus, ['FREIGEGEBEN', 'ABGERECHNET']),
              gte(serviceOrder.updatedAt, new Date(Date.now() - 14 * 86_400_000)),
            )!,
          );
        // Orders whose assignment changed must be (re)delivered even if the order row itself is unchanged.
        const assignedIds = assignments.map((a) => a.orderId);
        const orders = await tx
          .select()
          .from(serviceOrder)
          .where(
            assignedIds.length
              ? or(and(...orderConds), inArray(serviceOrder.id, assignedIds))
              : and(...orderConds),
          );
        const orderIds = orders.map((o) => o.id);
        const items = orderIds.length
          ? await tx
              .select({ item: serviceOrderItem, machine })
              .from(serviceOrderItem)
              .leftJoin(machine, eq(machine.id, serviceOrderItem.machineId))
              .where(inArray(serviceOrderItem.orderId, orderIds))
          : [];

        const stamps = await tx
          .select()
          .from(stampEvent)
          .where(
            and(
              eq(stampEvent.userId, scope.userId),
              cursor === null ? gte(stampEvent.deviceTime, historyFrom) : since(stampEvent.txId),
            ),
          )
          .orderBy(stampEvent.deviceTime);
        const entries = await tx
          .select()
          .from(timeEntry)
          .where(
            and(
              eq(timeEntry.userId, scope.userId),
              cursor === null ? gte(timeEntry.startAt, historyFrom) : since(timeEntry.txId),
            ),
          );
        const statusEvents = await tx
          .select()
          .from(orderStatusEvent)
          .where(
            and(since(orderStatusEvent.txId), orderIds.length || cursor !== null ? sql`true` : sql`false`),
          )
          .orderBy(desc(orderStatusEvent.at))
          .limit(500);

        // Time entries deleted by recomputation are reported via the full key set of the affected days.
        const [loc] = await tx
          .select({
            id: location.id,
            code: location.code,
            name: location.name,
            timezone: location.timezone,
            bundesland: location.bundesland,
          })
          .from(location)
          .where(eq(location.id, locationId));
        const overheads = await tx.select().from(overheadType).where(eq(overheadType.active, true));
        const settings = await tx
          .select({ key: setting.key, value: setting.value, locationId: setting.locationId })
          .from(setting)
          .where(or(isNull(setting.locationId), eq(setting.locationId, locationId)));

        // Material cache (ARCHITEKTUR 4.2): own location's storages (warehouse, vans, tank), compact item master.
        const storages = await tx
          .select()
          .from(storageLocation)
          .where(eq(storageLocation.locationId, locationId));
        const storageIds = storages.map((x) => x.id).concat(['00000000-0000-0000-0000-000000000000']);
        const stocks = await tx
          .select()
          .from(itemStock)
          .where(and(inArray(itemStock.storageLocationId, storageIds), since(itemStock.txId)));
        const itemCond = sql`(${item.isConsumable} or exists (select 1 from ${itemStock} s where s.item_id = item.id and s.storage_location_id in (${sql.join(
          storageIds.map((x) => sql`${x}::uuid`),
          sql`, `,
        )}) and s.bc_inventory > 0))`;
        const catalog = await tx
          .select({
            id: item.id,
            number: item.number,
            name: item.name,
            unit: item.unit,
            category: item.category,
            gtin: item.gtin,
            isConsumable: item.isConsumable,
            blocked: item.blocked,
            imageUrl: item.imageUrl,
          })
          .from(item)
          .where(
            and(
              itemCond,
              cursor === null
                ? sql`true`
                : or(
                    since(item.txId),
                    inArray(
                      item.id,
                      stocks.map((x) => x.itemId).concat(['00000000-0000-0000-0000-000000000000']),
                    ),
                  ),
            ),
          );
        const barcodes = catalog.length
          ? await tx
              .select({ itemId: itemBarcode.itemId, code: itemBarcode.code })
              .from(itemBarcode)
              .where(
                inArray(
                  itemBarcode.itemId,
                  catalog.map((i) => i.id),
                ),
              )
          : [];
        const containers = await tx
          .select()
          .from(container)
          .where(and(eq(container.locationId, locationId), since(container.txId)));
        const consumptions = await tx
          .select()
          .from(consumption)
          .where(
            and(
              eq(consumption.userId, scope.userId),
              cursor === null ? gte(consumption.createdAt, historyFrom) : since(consumption.txId),
            ),
          );
        const partRequests = await tx
          .select()
          .from(partRequest)
          .where(and(eq(partRequest.requestedBy, scope.userId), since(partRequest.txId)));

        // Documentation & communication (phase 5): only for orders visible to the Monteur (RLS).
        const visibleOrders = sql`exists (select 1 from ${serviceOrder} so where so.id = order_id)`;
        const reports = await tx
          .select()
          .from(workReport)
          .where(and(since(workReport.txId), visibleOrders));
        const templates = await tx
          .select()
          .from(textTemplate)
          .where(
            and(
              since(textTemplate.txId),
              or(isNull(textTemplate.locationId), eq(textTemplate.locationId, locationId)),
            ),
          );
        const checklistTemplates = await tx
          .select()
          .from(checklistTemplate)
          .where(
            and(
              since(checklistTemplate.txId),
              or(isNull(checklistTemplate.locationId), eq(checklistTemplate.locationId, locationId)),
            ),
          );
        const checklists = await tx
          .select()
          .from(orderChecklist)
          .where(and(since(orderChecklist.txId), visibleOrders));
        // The signature image stays on the server (and in the PDF); devices only need to know that it exists.
        const signatures = await tx
          .select({
            orderId: orderSignature.orderId,
            signerName: orderSignature.signerName,
            signedAt: orderSignature.signedAt,
            absentReason: orderSignature.absentReason,
          })
          .from(orderSignature)
          .where(and(since(orderSignature.txId), visibleOrders));
        const messages = await tx
          .select({ m: chatMessage, authorName: appUser.displayName })
          .from(chatMessage)
          .leftJoin(appUser, eq(appUser.id, chatMessage.authorId))
          .where(
            and(
              cursor === null ? gte(chatMessage.createdAt, historyFrom) : since(chatMessage.txId),
              isNull(chatMessage.deletedAt),
            ),
          )
          .orderBy(chatMessage.serverSeq)
          .limit(2000);
        const myMessageIds = (
          await tx
            .select({ id: chatMessage.id })
            .from(chatMessage)
            .where(and(eq(chatMessage.authorId, scope.userId), gte(chatMessage.createdAt, historyFrom)))
        ).map((x) => x.id);
        const reads = myMessageIds.length
          ? await tx.select().from(chatRead).where(inArray(chatRead.messageId, myMessageIds))
          : [];
        const photos = await tx
          .select()
          .from(photo)
          .where(and(since(photo.txId), isNull(photo.deletedAt)));

        const voided = await tx
          .select({ id: stampEventVoid.eventId })
          .from(stampEventVoid)
          .where(
            and(
              eq(stampEventVoid.userId, scope.userId),
              cursor === null ? sql`true` : gte(stampEventVoid.at, new Date(Date.now() - 2 * 86_400_000)),
            ),
          );
        const corrections = await tx
          .select()
          .from(timeCorrectionRequest)
          .where(and(eq(timeCorrectionRequest.userId, scope.userId), since(timeCorrectionRequest.txId)));
        // Own absences (with type) and vacation entitlements – the remaining vacation is computed offline.
        const absences = await tx
          .select()
          .from(absence)
          .where(and(eq(absence.userId, scope.userId), since(absence.txId)));
        const balances = await tx
          .select({
            year: vacationBalance.year,
            entitlementDays: vacationBalance.entitlementDays,
            carryOverDays: vacationBalance.carryOverDays,
          })
          .from(vacationBalance)
          .where(eq(vacationBalance.userId, scope.userId));

        return {
          voidedEventIds: voided.map((v) => v.id),
          storages,
          items: catalog.map((i) => ({
            ...i,
            barcodes: barcodes.filter((b) => b.itemId === i.id).map((b) => b.code),
          })),
          stocks,
          containers,
          consumptions,
          partRequests,
          workReports: reports,
          templates,
          checklistTemplates,
          orderChecklists: checklists,
          orderSignatures: signatures,
          chatMessages: messages.map((x) => ({ ...x.m, authorName: x.authorName })),
          chatReads: reads,
          photos: photos.map(({ blobPath: _b, ...p }) => p),
          correctionRequests: corrections,
          absences,
          vacationBalances: balances,
          cursor: next,
          full: cursor === null,
          serverTime: new Date().toISOString(),
          location: loc,
          orders: orders.map((o) => ({
            ...o,
            items: items
              .filter((i) => i.item.orderId === o.id)
              .map((i) => ({ ...i.item, machine: i.machine })),
          })),
          assignments,
          stampEvents: stamps,
          timeEntries: entries,
          timeEntryKeysByDay: await this.entryKeysForDays(tx, scope.userId, [
            ...new Set(entries.map((e) => e.workDate)),
          ]),
          statusEvents,
          overheadTypes: overheads,
          settings,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  /** Current entry ids per day, so the client can drop locally cached entries that were removed by recomputation. */
  private async entryKeysForDays(tx: Tx, userId: string, days: string[]): Promise<Record<string, string[]>> {
    if (!days.length) return {};
    const rows = await tx
      .select({ id: timeEntry.id, d: timeEntry.workDate })
      .from(timeEntry)
      .where(and(eq(timeEntry.userId, userId), inArray(timeEntry.workDate, days)));
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.d] ??= []).push(r.id);
    return out;
  }
}
