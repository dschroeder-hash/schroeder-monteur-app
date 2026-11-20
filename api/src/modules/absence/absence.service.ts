import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  absenceDays,
  addDays,
  localDate,
  rangesOverlap,
  vacationBalance,
  type AbsenceState,
  type Bundesland,
  type CommandPayload,
} from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db, type Tx } from '../../db/client.js';
import {
  absence,
  appUser,
  assignment,
  bcTransfer,
  location,
  setting,
  teamAbsence,
  userLocation,
  vacationBalance as vacationBalanceTable,
} from '../../db/schema.js';
import { notify } from '../notifications.js';
import { CommandRejected } from '../sync/command-rejected.js';
import { TransferService } from '../transfer/transfer.service.js';
import { ABSENCE_TARGETS, DEFAULT_ABSENCE_SETTINGS, type AbsenceSettings } from './absence-target.js';

type Absence = typeof absence.$inferSelect;
type Loc = typeof location.$inferSelect;

const fmt = (d: string) => d.split('-').reverse().join('.');
const range = (a: { fromDate: string; toDate: string | null }) =>
  a.toDate
    ? a.toDate === a.fromDate
      ? fmt(a.fromDate)
      : `${fmt(a.fromDate)}–${fmt(a.toDate)}`
    : `ab ${fmt(a.fromDate)}`;
/** A sick report without end is known only up to today – it must not block absences further in the future. */
const known = <T extends { fromDate: string; toDate: string | null }>(a: T, today: string) =>
  a.toDate ? a : { ...a, toDate: a.fromDate > today ? a.fromDate : today };
/** States in which an absence still "occupies" its days (no second absence allowed). */
const OPEN_STATES: AbsenceState[] = ['REPORTED', 'REQUESTED', 'APPROVED', 'CANCEL_REQUESTED'];

/**
 * Sick reports and vacation requests (PROMPT 5.9/5.10, ARCHITEKTUR 5.4).
 *  - Sick report: Monteur in 2 taps (offline command) or Meister/Personal on behalf; Meister + Personal notified;
 *    assigned orders in the period are marked "neu einplanen" on the planning board. The Meister acknowledges the
 *    report; as soon as it is acknowledged and has an end date it is transferred to BC (cause KRANK).
 *  - Vacation: requested → approved/rejected (reason) by the Meister → optional cancel request. Approval transfers
 *    to BC (cause URLAUB); cancelling or changing an absence deletes the BC entry and, if needed, writes a new one.
 * No diagnosis, no certificate: only period, code and an optional comment that never leaves the app.
 */
@Injectable()
export class AbsenceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TransferService) private readonly transfers: TransferService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private session(s: AccessScope) {
    return { userId: s.userId, roles: s.roles };
  }

  // -------------------------------------------------------------------------
  // Offline commands of the Monteur (called from SyncService.apply inside the Monteur's session)
  // -------------------------------------------------------------------------

  async reportSick(
    tx: Tx,
    scope: AccessScope,
    locationId: string,
    id: string,
    p: CommandPayload<'ReportSick'>,
  ): Promise<string[]> {
    return this.createSick(tx, scope, scope.userId, locationId, id, p, false);
  }

  async requestVacation(
    tx: Tx,
    scope: AccessScope,
    locationId: string,
    id: string,
    p: CommandPayload<'RequestVacation'>,
  ): Promise<string[]> {
    const warnings: string[] = [];
    const loc = await this.location(tx, locationId);
    await this.assertFree(tx, scope.userId, p, localDate(new Date(), loc.timezone));
    const days = absenceDays(p, loc.bundesland as Bundesland);
    if (days === 0) throw new CommandRejected('Im gewählten Zeitraum liegt kein Arbeitstag');
    await tx.insert(absence).values({
      id,
      userId: scope.userId,
      locationId,
      type: 'URLAUB',
      fromDate: p.fromDate,
      toDate: p.toDate,
      halfDay: p.halfDay,
      state: 'REQUESTED',
      comment: p.comment?.trim() || null,
    });
    const year = Number(p.fromDate.slice(0, 4));
    const balance = await this.balanceOf(tx, scope.userId, year, loc);
    if (balance.remaining < 0)
      warnings.push(
        `Der Resturlaub ${year} reicht dafür nicht aus (${balance.remaining} Tage). Ihr Meister entscheidet.`,
      );
    const name = await this.userName(tx, scope.userId);
    for (const m of await this.meisterOf(tx, locationId))
      await notify(
        tx,
        m,
        'VACATION_REQUEST',
        'Urlaubsantrag',
        `${name}: ${range(p)} (${days} ${days === 1 ? 'Tag' : 'Tage'})`,
        '/meister/freigaben',
      );
    return warnings;
  }

  async updateSickEndByMonteur(tx: Tx, scope: AccessScope, p: CommandPayload<'UpdateSickEnd'>) {
    const [a] = await tx.select().from(absence).where(eq(absence.id, p.absenceId)).for('update');
    if (!a || a.userId !== scope.userId || a.type !== 'KRANK')
      throw new CommandRejected('Krankmeldung nicht gefunden');
    if (a.state !== 'REPORTED') throw new CommandRejected('Krankmeldung ist nicht mehr aktiv');
    if (a.toDate === p.toDate) return [];
    // A change by the Monteur goes back to the Meister inbox; BC is only written after acknowledgement.
    await this.changeSickEnd(tx, a, p.toDate, false);
    await tx.update(absence).set({ decidedBy: null, decidedAt: null }).where(eq(absence.id, a.id));
    const name = await this.userName(tx, scope.userId);
    for (const m of await this.meisterOf(tx, a.locationId))
      await notify(
        tx,
        m,
        'SICK_REPORT',
        'Krankmeldung geändert',
        `${name}: voraussichtlich bis ${fmt(p.toDate)}`,
        '/meister/freigaben',
      );
    return [];
  }

  async withdrawVacation(tx: Tx, scope: AccessScope, p: CommandPayload<'WithdrawVacation'>) {
    const [a] = await tx.select().from(absence).where(eq(absence.id, p.absenceId)).for('update');
    if (!a || a.userId !== scope.userId || a.type !== 'URLAUB')
      throw new CommandRejected('Urlaubsantrag nicht gefunden');
    if (a.state === 'CANCELLED' || a.state === 'CANCEL_REQUESTED') return []; // replay / double tap
    if (a.state === 'REQUESTED') {
      await tx.update(absence).set({ state: 'CANCELLED' }).where(eq(absence.id, a.id));
      return [];
    }
    if (a.state !== 'APPROVED') throw new CommandRejected('Dieser Antrag kann nicht mehr storniert werden');
    await tx.update(absence).set({ state: 'CANCEL_REQUESTED' }).where(eq(absence.id, a.id));
    const name = await this.userName(tx, scope.userId);
    for (const m of await this.meisterOf(tx, a.locationId))
      await notify(
        tx,
        m,
        'VACATION_REQUEST',
        'Urlaub: Stornoantrag',
        `${name}: ${range(a)}`,
        '/meister/freigaben',
      );
    return [
      'Der Stornoantrag ist an Ihren Meister gegangen. Bis zur Entscheidung bleibt der Urlaub bestehen.',
    ];
  }

  // -------------------------------------------------------------------------
  // Meister / Personal
  // -------------------------------------------------------------------------

  /** Meister or Personal records a sick report on behalf of a Monteur (e.g. phone call in the morning). */
  async reportSickOnBehalf(
    scope: AccessScope,
    userId: string,
    p: { fromDate: string; toDate?: string | null; comment?: string | null },
  ) {
    if (userId === scope.userId)
      throw new ForbiddenException('Ihre eigene Krankmeldung erfassen Sie unter „Abwesenheit“');
    return withSession(this.db, this.session(scope), async (tx) => {
      const locationId = await this.monteurLocationFor(tx, scope, userId);
      const id = randomUUID();
      const warnings = await this.createSick(tx, scope, userId, locationId, id, p, true);
      await notify(
        tx,
        userId,
        'SICK_REPORT',
        'Krankmeldung erfasst',
        `Für Sie wurde eine Krankmeldung ${range({ fromDate: p.fromDate, toDate: p.toDate ?? null })} erfasst. Gute Besserung!`,
        '/monteur/abwesenheit',
      );
      return { id, warnings };
    });
  }

  async acknowledgeSick(scope: AccessScope, id: string) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const a = await this.lockForMeister(tx, scope, id);
      if (a.type !== 'KRANK' || a.state !== 'REPORTED')
        throw new ConflictException('Keine offene Krankmeldung');
      if (a.decidedAt) return { ok: true };
      await tx
        .update(absence)
        .set({ decidedBy: scope.userId, decidedAt: new Date() })
        .where(eq(absence.id, id));
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'ACKNOWLEDGE_SICK',
        entity: 'absence',
        entityId: id,
      });
      await this.syncToBc(tx, { ...a, decidedAt: new Date() });
      return { ok: true, transferred: !!a.toDate };
    });
  }

  /** End date of a sick report set by Meister or Personal ("wieder gesund ab", correction). */
  async setSickEnd(scope: AccessScope, id: string, toDate: string) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const [a] = await tx.select().from(absence).where(eq(absence.id, id)).for('update');
      if (!a || !this.canManage(scope, a)) throw new NotFoundException('Abwesenheit nicht gefunden');
      if (a.userId === scope.userId)
        throw new ForbiddenException(
          'Das Ende Ihrer eigenen Krankmeldung tragen Sie unter „Abwesenheit“ ein',
        );
      if (a.type !== 'KRANK' || a.state !== 'REPORTED')
        throw new ConflictException('Keine aktive Krankmeldung');
      await this.changeSickEnd(tx, a, toDate, !!a.decidedAt);
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'CHANGE_SICK_END',
        entity: 'absence',
        entityId: id,
        oldValue: { toDate: a.toDate },
        newValue: { toDate },
      });
      return { ok: true };
    });
  }

  /** Meister decides a vacation request or a cancel request. Rejections need a reason. */
  async decideVacation(scope: AccessScope, id: string, decision: 'APPROVE' | 'REJECT', reason: string) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const a = await this.lockForMeister(tx, scope, id);
      if (a.type !== 'URLAUB' || !['REQUESTED', 'CANCEL_REQUESTED'].includes(a.state))
        throw new ConflictException('Der Antrag ist bereits entschieden');
      if (decision === 'REJECT' && reason.trim().length < 3)
        throw new BadRequestException('Bei einer Ablehnung ist eine Begründung Pflicht');
      const cancel = a.state === 'CANCEL_REQUESTED';
      const next: AbsenceState = cancel
        ? decision === 'APPROVE'
          ? 'CANCELLED'
          : 'APPROVED'
        : decision === 'APPROVE'
          ? 'APPROVED'
          : 'REJECTED';
      await tx
        .update(absence)
        .set({
          state: next,
          decidedBy: scope.userId,
          decidedAt: new Date(),
          decisionReason: reason.trim() || null,
        })
        .where(eq(absence.id, id));
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: cancel ? 'DECIDE_VACATION_CANCEL' : 'DECIDE_VACATION',
        entity: 'absence',
        entityId: id,
        oldValue: { state: a.state },
        newValue: { state: next },
        reason: reason.trim() || undefined,
      });
      if (next === 'APPROVED' && !cancel) await this.syncToBc(tx, { ...a, state: next });
      if (next === 'CANCELLED') await this.syncToBc(tx, { ...a, state: next });
      const title = cancel
        ? decision === 'APPROVE'
          ? 'Urlaub storniert'
          : 'Stornoantrag abgelehnt'
        : decision === 'APPROVE'
          ? 'Urlaub genehmigt'
          : 'Urlaub abgelehnt';
      await notify(
        tx,
        a.userId,
        'VACATION_DECISION',
        title,
        `${range(a)}${reason.trim() ? ` – ${reason.trim()}` : ''}`,
        '/monteur/abwesenheit',
      );
      return { state: next };
    });
  }

  /** Open items for the Meister inbox: vacation (cancel) requests and unacknowledged sick reports. */
  async inboxItems(tx: Tx, locationId: string) {
    const rows = await tx
      .select({ a: absence, userName: appUser.displayName })
      .from(absence)
      .innerJoin(appUser, eq(appUser.id, absence.userId))
      .where(
        and(
          eq(absence.locationId, locationId),
          or(
            inArray(absence.state, ['REQUESTED', 'CANCEL_REQUESTED']),
            and(eq(absence.state, 'REPORTED'), isNull(absence.decidedAt)),
          ),
        ),
      )
      .orderBy(asc(absence.fromDate));
    const [loc] = await tx.select().from(location).where(eq(location.id, locationId));
    const land = loc!.bundesland as Bundesland;
    const out = [];
    for (const { a, userName } of rows) {
      const year = Number(a.fromDate.slice(0, 4));
      out.push({
        ...a,
        userName,
        days: absenceDays(a, land),
        balance: a.type === 'URLAUB' ? await this.balanceOf(tx, a.userId, year, loc!) : null,
        // Other absences of the team in the same period – helps deciding.
        overlapping: (
          await tx
            .select({
              userName: appUser.displayName,
              fromDate: teamAbsence.fromDate,
              toDate: teamAbsence.toDate,
            })
            .from(teamAbsence)
            .innerJoin(appUser, eq(appUser.id, teamAbsence.userId))
            .where(and(eq(teamAbsence.locationId, locationId), ne(teamAbsence.userId, a.userId)))
        ).filter((o) => rangesOverlap(o, a)),
        affectedAssignments: a.type === 'KRANK' ? await this.assignmentsIn(tx, a, loc!) : 0,
      });
    }
    return out;
  }

  /** Absences with type – Meister (own locations) or Personal (all or one location). */
  async list(scope: AccessScope, q: { from: string; to: string; locationId?: string }) {
    const personal = scope.roles.includes('Werkstatt.Personal');
    const locs = q.locationId ? [q.locationId] : personal ? null : scope.meisterLocationIds;
    if (q.locationId && !personal && !scope.meisterLocationIds.includes(q.locationId))
      throw new ForbiddenException('Keine Berechtigung für diesen Standort');
    return withSession(this.db, this.session(scope), async (tx) => {
      const rows = await tx
        .select({
          a: absence,
          userName: appUser.displayName,
          locationName: location.name,
          bundesland: location.bundesland,
        })
        .from(absence)
        .innerJoin(appUser, eq(appUser.id, absence.userId))
        .innerJoin(location, eq(location.id, absence.locationId))
        .where(
          and(
            locs
              ? inArray(absence.locationId, locs.length ? locs : ['00000000-0000-0000-0000-000000000000'])
              : sql`true`,
            lte(absence.fromDate, q.to),
            or(isNull(absence.toDate), gte(absence.toDate, q.from)),
            ne(absence.state, 'CANCELLED'),
          ),
        )
        .orderBy(asc(absence.fromDate));
      const ids = rows.map((r) => r.a.id);
      const sent = ids.length
        ? await tx
            .select({
              subjectId: bcTransfer.subjectId,
              state: bcTransfer.state,
              op: sql<string>`${bcTransfer.payload}->>'op'`,
            })
            .from(bcTransfer)
            .where(and(eq(bcTransfer.subjectType, 'absence'), inArray(bcTransfer.subjectId, ids)))
        : [];
      return rows.map(({ a, userName, locationName, bundesland }) => {
        const t = sent.filter((s) => s.subjectId === a.id);
        return {
          ...a,
          userName,
          locationName,
          days: absenceDays(a, bundesland as Bundesland),
          bcState: !t.length
            ? null
            : t.some((x) => x.state === 'FAILED' || x.state === 'DEAD')
              ? 'FEHLER'
              : t.every((x) => x.state === 'DONE')
                ? 'UEBERTRAGEN'
                : 'AUSSTEHEND',
        };
      });
    });
  }

  /** Team calendar for the Monteur: colleagues of the own locations, "abwesend" only (no type, no comment). */
  async team(scope: AccessScope, from: string, to: string) {
    return withSession(this.db, this.session(scope), async (tx) =>
      tx
        .select({
          userId: teamAbsence.userId,
          userName: appUser.displayName,
          fromDate: teamAbsence.fromDate,
          toDate: teamAbsence.toDate,
          halfDay: teamAbsence.halfDay,
        })
        .from(teamAbsence)
        .innerJoin(appUser, eq(appUser.id, teamAbsence.userId))
        .where(
          and(
            inArray(
              teamAbsence.locationId,
              scope.locationIds.length ? scope.locationIds : ['00000000-0000-0000-0000-000000000000'],
            ),
            lte(teamAbsence.fromDate, to),
            or(isNull(teamAbsence.toDate), gte(teamAbsence.toDate, from)),
          ),
        )
        .orderBy(asc(teamAbsence.fromDate)),
    );
  }

  /** Vacation entitlements per Monteur and year (Personal: all, Meister: own locations; source "App", OP-03). */
  async balances(scope: AccessScope, year: number) {
    const personal = scope.roles.includes('Werkstatt.Personal');
    return withSession(this.db, this.session(scope), async (tx) => {
      const users = await tx
        .selectDistinct({ id: appUser.id, name: appUser.displayName, locationId: userLocation.locationId })
        .from(appUser)
        .innerJoin(userLocation, and(eq(userLocation.userId, appUser.id), eq(userLocation.role, 'MONTEUR')))
        .where(
          and(
            eq(appUser.active, true),
            personal
              ? sql`true`
              : inArray(
                  userLocation.locationId,
                  scope.meisterLocationIds.length
                    ? scope.meisterLocationIds
                    : ['00000000-0000-0000-0000-000000000000'],
                ),
          ),
        )
        .orderBy(asc(appUser.displayName));
      const out = [];
      const seen = new Set<string>();
      for (const u of users) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        const loc = await this.location(tx, u.locationId);
        out.push({
          userId: u.id,
          userName: u.name,
          locationId: loc.id,
          locationName: loc.name,
          ...(await this.balanceOf(tx, u.id, year, loc)),
        });
      }
      return out;
    });
  }

  async setBalance(
    scope: AccessScope,
    b: { userId: string; year: number; entitlementDays: number; carryOverDays: number },
  ) {
    return withSession(this.db, this.session(scope), async (tx) => {
      const [old] = await tx
        .select()
        .from(vacationBalanceTable)
        .where(and(eq(vacationBalanceTable.userId, b.userId), eq(vacationBalanceTable.year, b.year)));
      if (old)
        await tx
          .update(vacationBalanceTable)
          .set({ entitlementDays: b.entitlementDays, carryOverDays: b.carryOverDays })
          .where(and(eq(vacationBalanceTable.userId, b.userId), eq(vacationBalanceTable.year, b.year)));
      else await tx.insert(vacationBalanceTable).values({ ...b, source: 'APP' });
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'SET_VACATION_BALANCE',
        entity: 'vacation_balance',
        entityId: b.userId,
        oldValue: old
          ? { year: old.year, entitlementDays: old.entitlementDays, carryOverDays: old.carryOverDays }
          : undefined,
        newValue: b,
      });
      return { ok: true };
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async createSick(
    tx: Tx,
    scope: AccessScope,
    userId: string,
    locationId: string,
    id: string,
    p: { fromDate: string; toDate?: string | null; comment?: string | null },
    byManager: boolean,
  ): Promise<string[]> {
    const warnings: string[] = [];
    const toDate = p.toDate ?? null;
    if (toDate && toDate < p.fromDate) throw new CommandRejected('Ende liegt vor dem Beginn');
    const loc = await this.location(tx, locationId);
    const today = localDate(new Date(), loc.timezone);
    const others = await tx
      .select()
      .from(absence)
      .where(and(eq(absence.userId, userId), inArray(absence.state, OPEN_STATES)));
    const mine = known({ fromDate: p.fromDate, toDate }, today);
    const clash = others.filter((o) => rangesOverlap(known(o, today), mine));
    if (clash.some((o) => o.type === 'KRANK'))
      throw new CommandRejected('Für diesen Zeitraum liegt bereits eine Krankmeldung vor');
    const vacation = clash.filter((o) => o.type === 'URLAUB' && o.state !== 'REQUESTED');
    if (vacation.length)
      warnings.push(
        'Die Krankmeldung überschneidet sich mit genehmigtem Urlaub. Die Personalabteilung ist informiert.',
      );
    await tx.insert(absence).values({
      id,
      userId,
      locationId,
      type: 'KRANK',
      fromDate: p.fromDate,
      toDate,
      state: 'REPORTED',
      comment: p.comment?.trim() || null,
      ...(byManager ? { decidedBy: scope.userId, decidedAt: new Date() } : {}),
    });
    const affected = await this.assignmentsIn(tx, { fromDate: p.fromDate, toDate }, loc, userId);
    const name = await this.userName(tx, userId);
    const text = `${name}: ${range({ fromDate: p.fromDate, toDate })}${affected ? ` – ${affected} ${affected === 1 ? 'Auftrag' : 'Aufträge'} neu einplanen` : ''}${vacation.length ? ' – überschneidet sich mit Urlaub' : ''}`;
    const recipients = new Set([
      ...(await this.meisterOf(tx, locationId)),
      ...(await this.personalUsers(tx)),
    ]);
    recipients.delete(scope.userId);
    for (const u of recipients)
      await notify(tx, u, 'SICK_REPORT', 'Krankmeldung', text, '/meister/abwesenheiten');
    if (byManager) await this.syncToBc(tx, (await tx.select().from(absence).where(eq(absence.id, id)))[0]!);
    return warnings;
  }

  private async changeSickEnd(tx: Tx, a: Absence, toDate: string, sync: boolean) {
    if (toDate < a.fromDate) throw new CommandRejected('Ende liegt vor dem Beginn');
    const others = await tx
      .select()
      .from(absence)
      .where(
        and(
          eq(absence.userId, a.userId),
          eq(absence.type, 'KRANK'),
          eq(absence.state, 'REPORTED'),
          ne(absence.id, a.id),
        ),
      );
    if (others.some((o) => rangesOverlap(o, { fromDate: a.fromDate, toDate })))
      throw new CommandRejected('Für diesen Zeitraum liegt bereits eine Krankmeldung vor');
    if (a.toDate === toDate) return;
    await tx.update(absence).set({ toDate }).where(eq(absence.id, a.id));
    if (sync) await this.syncToBc(tx, { ...a, toDate });
  }

  /**
   * Brings BC in line with the absence: deletes all BC entries written so far and writes one entry for the current
   * period if the absence belongs in BC. Called only on changes, so an unchanged absence is never rewritten.
   */
  private async syncToBc(tx: Tx, a: Absence) {
    const loc = await this.location(tx, a.locationId);
    const settings = await this.settings(tx, a.locationId);
    const target = ABSENCE_TARGETS[settings.bcTarget] ?? ABSENCE_TARGETS.EMPLOYEE_ABSENCE!;
    const groupKey = `absence:${a.id}`;
    const existing = await tx
      .select({ id: bcTransfer.id, payload: bcTransfer.payload })
      .from(bcTransfer)
      .where(and(eq(bcTransfer.subjectType, 'absence'), eq(bcTransfer.subjectId, a.id)));
    const deleted = new Set(
      existing
        .map((t) => t.payload as { op: string; ref?: { id: string } })
        .filter((p) => p.op === 'delete')
        .map((p) => p.ref!.id),
    );
    for (const t of existing) {
      const p = t.payload as { op: string; endpoint: string };
      if (p.op !== 'create' || deleted.has(t.id)) continue;
      await this.transfers.enqueue(tx, {
        locationId: a.locationId,
        bcCompanyId: loc.bcCompanyId,
        target: 'ABSENCE',
        subjectType: 'absence',
        subjectId: a.id,
        groupKey,
        payload: {
          op: 'delete',
          endpoint: p.endpoint as 'employeeAbsences',
          ref: { table: 'bc_transfer', id: t.id },
        },
      });
    }
    const belongs =
      (a.type === 'URLAUB' && (a.state === 'APPROVED' || a.state === 'CANCEL_REQUESTED')) ||
      (a.type === 'KRANK' && a.state === 'REPORTED' && !!a.decidedAt && !!a.toDate);
    if (!belongs) return;
    const quantity = absenceDays(a, loc.bundesland as Bundesland);
    if (quantity === 0) return;
    await this.transfers.enqueue(tx, {
      locationId: a.locationId,
      bcCompanyId: loc.bcCompanyId,
      target: 'ABSENCE',
      subjectType: 'absence',
      subjectId: a.id,
      groupKey,
      payload: {
        op: 'create',
        endpoint: target.endpoint,
        body: target.createBody(
          { type: a.type, fromDate: a.fromDate, toDate: a.toDate!, halfDay: a.halfDay, quantity },
          settings,
        ),
        meta: { employeeOfUserId: a.userId },
      },
    });
  }

  private async settings(tx: Tx, locationId: string): Promise<AbsenceSettings> {
    const rows = await tx
      .select()
      .from(setting)
      .where(
        and(eq(setting.key, 'absence'), or(isNull(setting.locationId), eq(setting.locationId, locationId))),
      );
    const v = ((rows.find((r) => r.locationId === locationId) ?? rows[0])?.value ??
      {}) as Partial<AbsenceSettings>;
    return {
      ...DEFAULT_ABSENCE_SETTINGS,
      ...v,
      causeCodes: { ...DEFAULT_ABSENCE_SETTINGS.causeCodes, ...(v.causeCodes ?? {}) },
    };
  }

  async balanceOf(tx: Tx, userId: string, year: number, loc: Loc) {
    const [base] = await tx
      .select()
      .from(vacationBalanceTable)
      .where(and(eq(vacationBalanceTable.userId, userId), eq(vacationBalanceTable.year, year)));
    const list = await tx
      .select()
      .from(absence)
      .where(
        and(
          eq(absence.userId, userId),
          eq(absence.type, 'URLAUB'),
          lte(absence.fromDate, `${year}-12-31`),
          gte(sql`coalesce(${absence.toDate}, ${absence.fromDate})`, `${year}-01-01`),
        ),
      );
    return vacationBalance(year, base ?? null, list, loc.bundesland as Bundesland);
  }

  /** Active assignments of the user within the absence period (open end: the next 14 days). */
  private async assignmentsIn(
    tx: Tx,
    a: { fromDate: string; toDate: string | null; userId?: string },
    loc: Loc,
    userId = a.userId!,
  ) {
    const until = a.toDate ?? addDays(a.fromDate, 14);
    const rows = await tx
      .select({ start: assignment.plannedStart })
      .from(assignment)
      .where(and(eq(assignment.userId, userId), isNull(assignment.cancelledAt)));
    return rows.filter((r) => {
      const d = localDate(r.start, loc.timezone);
      return d >= a.fromDate && d <= until;
    }).length;
  }

  /**
   * A vacation must not overlap another absence. A sick report without end only counts up to today – otherwise an
   * open sick report would block every later vacation request.
   */
  private async assertFree(tx: Tx, userId: string, p: { fromDate: string; toDate: string }, today: string) {
    const others = await tx
      .select()
      .from(absence)
      .where(and(eq(absence.userId, userId), inArray(absence.state, OPEN_STATES)));
    if (others.some((o) => rangesOverlap(known(o, today), p)))
      throw new CommandRejected('Für diesen Zeitraum gibt es bereits eine Abwesenheit');
  }

  private canManage(scope: AccessScope, a: Absence) {
    return scope.roles.includes('Werkstatt.Personal') || scope.meisterLocationIds.includes(a.locationId);
  }

  private async lockForMeister(tx: Tx, scope: AccessScope, id: string) {
    const [a] = await tx.select().from(absence).where(eq(absence.id, id)).for('update');
    if (!a || !scope.meisterLocationIds.includes(a.locationId))
      throw new NotFoundException('Abwesenheit nicht gefunden');
    // Four-eyes principle: own absences are decided by another Meister.
    if (a.userId === scope.userId)
      throw new ForbiddenException(
        'Eigene Abwesenheiten entscheidet ein anderer Meister (Vier-Augen-Prinzip)',
      );
    return a;
  }

  /** Monteur location of a user that the caller may manage (Meister: own locations, Personal: all). */
  private async monteurLocationFor(tx: Tx, scope: AccessScope, userId: string) {
    const rows = await tx
      .select({ locationId: userLocation.locationId })
      .from(userLocation)
      .where(and(eq(userLocation.userId, userId), eq(userLocation.role, 'MONTEUR')));
    const personal = scope.roles.includes('Werkstatt.Personal');
    const loc = rows.find((r) => personal || scope.meisterLocationIds.includes(r.locationId));
    if (!loc) throw new NotFoundException('Monteur nicht gefunden');
    return loc.locationId;
  }

  private async location(tx: Tx, id: string) {
    const [l] = await tx.select().from(location).where(eq(location.id, id));
    if (!l) throw new NotFoundException('Standort nicht gefunden');
    return l;
  }

  private async userName(tx: Tx, id: string) {
    const [u] = await tx.select({ n: appUser.displayName }).from(appUser).where(eq(appUser.id, id));
    return u?.n ?? 'Unbekannt';
  }

  private async meisterOf(tx: Tx, locationId: string) {
    const rows = await tx
      .selectDistinct({ userId: userLocation.userId })
      .from(userLocation)
      .where(and(eq(userLocation.locationId, locationId), eq(userLocation.role, 'MEISTER')));
    return rows.map((r) => r.userId);
  }

  private async personalUsers(tx: Tx) {
    const rows = await tx
      .select({ id: appUser.id })
      .from(appUser)
      .where(and(eq(appUser.active, true), sql`'Werkstatt.Personal' = ANY (${appUser.roles})`));
    return rows.map((r) => r.id);
  }
}
