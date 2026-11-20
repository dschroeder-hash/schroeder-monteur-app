import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Param,
  Post,
  Put,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, asc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  ACTIVITIES,
  addDays,
  currentState,
  deriveSegments,
  localDate,
  ROLES,
  zonedToUtc,
  type CommandType,
  type StampEvent,
} from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Roles, Scope } from '../../auth/decorators.js';
import { ScopeService } from '../../auth/scope.service.js';
import { AuditService } from '../../common/audit.service.js';
import { uuidParam, ZodBody, ZodPipe } from '../../common/zod.js';
import { withSession, type Db } from '../../db/client.js';
import { DB } from '../../db/db.module.js';
import {
  appUser,
  assignment,
  bcResourceMapping,
  location,
  serviceOrder,
  stampEvent,
  userLocation,
  userPin,
} from '../../db/schema.js';
import { SyncService } from '../sync/sync.service.js';
import { TimeService } from '../time/time.service.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const pinSchema = z.string().regex(/^\d{4}$/, 'PIN: genau 4 Ziffern');

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await scryptAsync(pin, salt, 32)).toString('base64')}`;
}
async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(pin, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const identifyBody = z.object({ personnelNo: z.string().trim().min(1).max(20), pin: pinSchema });
const STAMP_TYPES = [
  'StampClockIn',
  'StampClockOut',
  'StampJobStart',
  'StampJobStop',
  'StampBreakStart',
  'StampBreakStop',
] as const;
const stampBody = identifyBody.extend({
  type: z.enum(STAMP_TYPES),
  orderId: z.string().uuid().optional(),
  activity: z.enum(ACTIVITIES).optional(),
});

/**
 * Shared workshop PC per location (E-72): stays signed in with a device account (role Werkstatt.Terminal);
 * employees stamp with personnel number + 4-digit PIN, like the BC stamp clock. The stamp is applied as the
 * employee through the normal sync path (same rules, stamp clock, auditing); wrong PINs lock the employee's PIN
 * for 15 minutes after 5 attempts. Unknown numbers and wrong PINs give the same answer (no enumeration).
 */
@Injectable()
export class TerminalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ScopeService) private readonly scopes: ScopeService,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(TimeService) private readonly time: TimeService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private sess(s: AccessScope) {
    return { userId: s.userId, roles: s.roles };
  }

  /** Employee behind personnel number + PIN, Monteur at one of the terminal's locations. */
  async identify(terminal: AccessScope, personnelNo: string, pin: string) {
    const locs = terminal.terminalLocationIds ?? [];
    if (!locs.length)
      throw new ForbiddenException('Dieses Konto ist keinem Standort als Werkstatt-PC zugeordnet');
    const wrong = () => new UnauthorizedException('Personalnummer oder PIN falsch');
    // The failure counter must survive the rejection: decide inside the transaction, throw after the commit.
    const outcome = await withSession(this.db, this.sess(terminal), async (tx) => {
      const [m] = await tx
        .select({ userId: bcResourceMapping.userId })
        .from(bcResourceMapping)
        .innerJoin(userLocation, eq(userLocation.userId, bcResourceMapping.userId))
        .where(
          and(
            or(
              eq(bcResourceMapping.bcEmployeeNo, personnelNo),
              eq(bcResourceMapping.bcResourceNo, personnelNo),
            ),
            eq(userLocation.role, 'MONTEUR'),
            inArray(userLocation.locationId, locs),
          ),
        )
        .limit(1);
      if (!m) return { error: 'wrong' as const };
      const [p] = await tx.select().from(userPin).where(eq(userPin.userId, m.userId)).for('update');
      if (!p) return { error: 'nopin' as const };
      if (p.lockedUntil && p.lockedUntil > new Date())
        return { error: 'locked' as const, until: p.lockedUntil };
      if (!(await pinMatches(pin, p.pinHash))) {
        const failed = p.failedAttempts + 1;
        const lock = failed >= MAX_FAILED;
        await tx
          .update(userPin)
          .set({
            failedAttempts: lock ? 0 : failed,
            lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : p.lockedUntil,
          })
          .where(eq(userPin.userId, m.userId));
        if (lock)
          await this.audit.log(tx, {
            actorId: terminal.userId,
            action: 'PIN_LOCKED',
            entity: 'app_user',
            entityId: m.userId,
          });
        return { error: 'wrong' as const };
      }
      if (p.failedAttempts)
        await tx.update(userPin).set({ failedAttempts: 0 }).where(eq(userPin.userId, m.userId));
      return { userId: m.userId };
    });
    if ('userId' in outcome && outcome.userId) return outcome.userId;
    if (outcome.error === 'nopin')
      throw new UnprocessableEntityException('Für diese Personalnummer ist noch keine PIN festgelegt');
    if (outcome.error === 'locked')
      throw new HttpException(
        `PIN gesperrt bis ${outcome.until.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr`,
        423,
      );
    throw wrong();
  }

  /** Name, current state and today's orders of the employee (for the buttons on the PC). */
  async overview(userId: string) {
    const scope = await this.scopes.forUser(userId);
    return withSession(this.db, this.sess(scope), async (tx) => {
      const [u] = await tx.select({ name: appUser.displayName }).from(appUser).where(eq(appUser.id, userId));
      const locId = scope.monteurLocationIds[0];
      const [loc] = locId ? await tx.select().from(location).where(eq(location.id, locId)) : [];
      const tz = loc?.timezone ?? 'Europe/Berlin';
      const today = localDate(new Date(), tz);
      const from = zonedToUtc(addDays(today, -1), '00:00', tz);
      const rows = await tx
        .select()
        .from(stampEvent)
        .where(and(eq(stampEvent.userId, userId), gte(stampEvent.deviceTime, from)))
        .orderBy(asc(stampEvent.deviceTime));
      const events: StampEvent[] = rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        deviceTime: r.deviceTime.toISOString(),
        orderId: r.orderId,
        activity: r.activity,
        overheadCode: r.overheadCode,
      }));
      const cfg = locId ? await this.time.rounding(tx, locId) : null;
      const state = currentState(deriveSegments(events, tz, cfg?.stampClock ?? null));
      const orders = await tx
        .select({
          id: serviceOrder.id,
          bcNo: serviceOrder.bcNo,
          customerName: serviceOrder.customerName,
          description: serviceOrder.description,
        })
        .from(assignment)
        .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
        .where(
          and(
            eq(assignment.userId, userId),
            isNull(assignment.cancelledAt),
            gte(assignment.plannedStart, zonedToUtc(today, '00:00', tz)),
            lt(assignment.plannedStart, zonedToUtc(addDays(today, 1), '00:00', tz)),
          ),
        );
      return {
        name: u?.name ?? '',
        clockedIn: state.clockedIn,
        onBreak: !!state.onBreak,
        job: state.job?.orderId
          ? { orderId: state.job.orderId, activity: state.job.activity }
          : state.job
            ? { orderId: null, activity: null }
            : null,
        orders,
      };
    });
  }

  async stamp(terminal: AccessScope, body: z.infer<typeof stampBody>) {
    const userId = await this.identify(terminal, body.personnelNo, body.pin);
    const scope = await this.scopes.forUser(userId);
    const payload: Record<string, unknown> = {};
    if (body.type === 'StampJobStart') {
      if (!body.orderId || !body.activity)
        throw new UnprocessableEntityException('Auftrag und Tätigkeit angeben');
      payload.orderId = body.orderId;
      payload.activity = body.activity;
    }
    if (body.type === 'StampJobStop' && body.orderId) payload.orderId = body.orderId;
    const now = new Date();
    const res = await this.sync.push(scope, {
      deviceId: `terminal:${terminal.userId}`,
      deviceNow: now.toISOString(),
      commands: [
        {
          id: randomUUID(),
          type: body.type as CommandType,
          deviceTime: now.toISOString(),
          // device_seq is an int4: seconds since 2026 keep it small and increasing per PC
          deviceSeq: Math.floor((now.getTime() - Date.UTC(2026, 0, 1)) / 1000),
          payload,
        },
      ],
    });
    const r = res.results[0];
    if (r?.result === 'rejected') throw new UnprocessableEntityException(r.reason ?? 'Stempelung abgelehnt');
    return { ...(await this.overview(userId)), warnings: r && 'warnings' in r ? r.warnings : undefined };
  }
}

@ApiTags('Werkstatt-PC')
@ApiBearerAuth()
@Controller('v1/terminal')
@Roles(ROLES.Terminal)
export class TerminalController {
  constructor(@Inject(TerminalService) private readonly terminal: TerminalService) {}

  @Post('identify')
  @HttpCode(200)
  @ZodBody(identifyBody)
  async identify(@Scope() s: AccessScope, @Body(new ZodPipe(identifyBody)) b: z.infer<typeof identifyBody>) {
    return this.terminal.overview(await this.terminal.identify(s, b.personnelNo, b.pin));
  }

  @Post('stamp')
  @HttpCode(200)
  @ZodBody(stampBody)
  stamp(@Scope() s: AccessScope, @Body(new ZodPipe(stampBody)) b: z.infer<typeof stampBody>) {
    return this.terminal.stamp(s, b);
  }
}

const pinBody = z.object({ pin: pinSchema });

/** Own stamp PIN (any employee, on the own device) and PIN reset by the Admin. */
@ApiTags('Werkstatt-PC')
@ApiBearerAuth()
@Controller('v1')
export class PinController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async set(actor: AccessScope, userId: string, pin: string) {
    const pinHash = await hashPin(pin);
    await withSession(this.db, { userId: actor.userId, roles: actor.roles }, async (tx) => {
      await tx
        .insert(userPin)
        .values({ userId, pinHash })
        .onConflictDoUpdate({
          target: userPin.userId,
          set: { pinHash, failedAttempts: 0, lockedUntil: null },
        });
      await this.audit.log(tx, {
        actorId: actor.userId,
        action: 'SET_PIN',
        entity: 'app_user',
        entityId: userId,
      });
    });
  }

  @Put('me/pin')
  @Roles(ROLES.Monteur)
  @ZodBody(pinBody)
  async own(@Scope() s: AccessScope, @Body(new ZodPipe(pinBody)) b: z.infer<typeof pinBody>) {
    await this.set(s, s.userId, b.pin);
    return { ok: true };
  }

  @Put('admin/users/:id/pin')
  @Roles(ROLES.Admin)
  @ZodBody(pinBody)
  async admin(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(pinBody)) b: z.infer<typeof pinBody>,
  ) {
    await this.set(s, id, b.pin);
    return { ok: true };
  }
}
