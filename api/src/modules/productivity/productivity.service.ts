import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  localDate,
  PRODUCTIVITY_CATEGORIES,
  sumProductivity,
  type ProductivityCategory,
  type ProductivityConfig,
  type ProductivityResult,
} from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { AuditService } from '../../common/audit.service.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db, type Tx } from '../../db/client.js';
import {
  appUser,
  location,
  orderType,
  orderTypeMapping,
  overheadType,
  productivitySnapshot,
  setting,
  userLocation,
} from '../../db/schema.js';
import { FeatureService } from '../../features/feature.service.js';
import { computeMonth, mappingRules, productivityConfig, shiftMonth, type Loc } from './productivity.calc.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Productivity (PROMPT 5.11). Monteur: own values only (current month, previous month, 12-month trend).
 * Meister: the same per Monteur of the location plus location total. Both behind works-council feature flags
 * (`productivity.self`, `productivity.team`, PROMPT 9). Closed months come from the monthly snapshot if present.
 */
@Injectable()
export class ProductivityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FeatureService) private readonly features: FeatureService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private session(s: AccessScope) {
    return { userId: s.userId, roles: s.roles };
  }

  private async loc(tx: Tx, id: string): Promise<Loc & { name: string }> {
    const [l] = await tx
      .select({
        id: location.id,
        name: location.name,
        timezone: location.timezone,
        bundesland: location.bundesland,
      })
      .from(location)
      .where(eq(location.id, id));
    return l!;
  }

  private currentMonth(tz: string) {
    return localDate(new Date(), tz).slice(0, 7);
  }

  /** Closed month → snapshot (reproducible), current month → live. */
  private async month(
    tx: Tx,
    userId: string,
    loc: Loc,
    month: string,
    current: string,
    shared: Parameters<typeof computeMonth>[4],
  ) {
    if (month < current) {
      const [snap] = await tx
        .select({ result: productivitySnapshot.result })
        .from(productivitySnapshot)
        .where(and(eq(productivitySnapshot.userId, userId), eq(productivitySnapshot.month, `${month}-01`)));
      if (snap) return { ...(snap.result as ProductivityResult), snapshot: true };
    }
    return { ...(await computeMonth(tx, userId, loc, month, shared)), snapshot: false };
  }

  async mine(scope: AccessScope, month?: string) {
    const locationId = scope.monteurLocationIds[0];
    if (!locationId) throw new ForbiddenException('Kein Standort als Monteur zugeordnet');
    if (!(await this.features.isEnabled('productivity.self', locationId)))
      throw new ForbiddenException('Die Produktivitätsansicht ist für Ihren Standort nicht freigeschaltet');
    return withSession(this.db, this.session(scope), async (tx) => {
      const loc = await this.loc(tx, locationId);
      const current = this.currentMonth(loc.timezone);
      const selected = month ?? current;
      if (!MONTH.test(selected) || selected > current) throw new BadRequestException('Ungültiger Monat');
      const shared = await this.shared(tx, locationId);
      const trend = [];
      for (let i = 11; i >= 0; i--)
        trend.push(await this.month(tx, scope.userId, loc, shiftMonth(selected, -i), current, shared));
      return {
        month: selected,
        current: trend.at(-1)!,
        previous: trend.at(-2)!,
        trend: trend.map((r) => ({
          month: r.month,
          productivity: r.productivity,
          attendanceMinutes: r.attendanceMinutes,
          byCategory: Object.fromEntries(
            PRODUCTIVITY_CATEGORIES.map((c) => [c, r.byCategory[c].minutes]),
          ) as Record<ProductivityCategory, number>,
        })),
      };
    });
  }

  async team(scope: AccessScope, locationId: string, month?: string) {
    if (!scope.meisterLocationIds.includes(locationId))
      throw new ForbiddenException('Keine Berechtigung für diesen Standort');
    if (!(await this.features.isEnabled('productivity.team', locationId)))
      throw new ForbiddenException(
        'Die Teamansicht Produktivität ist für diesen Standort nicht freigeschaltet',
      );
    return withSession(this.db, this.session(scope), async (tx) => {
      const loc = await this.loc(tx, locationId);
      const current = this.currentMonth(loc.timezone);
      const selected = month ?? current;
      if (!MONTH.test(selected) || selected > current) throw new BadRequestException('Ungültiger Monat');
      const shared = await this.shared(tx, locationId);
      const monteure = await tx
        .selectDistinct({ id: appUser.id, name: appUser.displayName, isApprentice: appUser.isApprentice })
        .from(userLocation)
        .innerJoin(appUser, eq(appUser.id, userLocation.userId))
        .where(
          and(
            eq(userLocation.locationId, locationId),
            eq(userLocation.role, 'MONTEUR'),
            eq(appUser.active, true),
          ),
        )
        .orderBy(asc(appUser.displayName));
      const rows = [];
      for (const m of monteure) {
        const cur = await this.month(tx, m.id, loc, selected, current, shared);
        const prev = await this.month(tx, m.id, loc, shiftMonth(selected, -1), current, shared);
        rows.push({
          userId: m.id,
          name: m.name,
          isApprentice: m.isApprentice,
          current: cur,
          previousProductivity: prev.productivity,
        });
      }
      return {
        month: selected,
        location: { id: loc.id, name: loc.name },
        monteure: rows,
        total: sumProductivity(
          selected,
          rows.map((r) => r.current),
        ),
      };
    });
  }

  private async shared(tx: Tx, locationId: string) {
    return {
      mapping: await mappingRules(tx),
      config: await productivityConfig(tx, locationId),
      overheads: await tx
        .select({ code: overheadType.code, countsAsAttendance: overheadType.countsAsAttendance })
        .from(overheadType),
    };
  }

  // -------------------------------------------------------------------------
  // Admin: mapping versions and target corridor
  // -------------------------------------------------------------------------

  async adminConfig() {
    return this.db.transaction(async (tx) => ({
      mapping: await tx
        .select()
        .from(orderTypeMapping)
        .orderBy(asc(orderTypeMapping.orderTypeCode), asc(orderTypeMapping.validFrom)),
      orderTypes: await tx
        .selectDistinct({ code: orderType.code, description: orderType.description })
        .from(orderType)
        .orderBy(asc(orderType.code)),
      config: await productivityConfig(tx, '00000000-0000-0000-0000-000000000000'),
    }));
  }

  /** New mapping version. Only from the current month on – closed months stay unchanged (E-23). */
  async addMapping(
    scope: AccessScope,
    m: {
      orderTypeCode: string;
      category: ProductivityCategory;
      productive: boolean;
      external: boolean;
      validFrom: string;
    },
  ) {
    const firstOfMonth = `${localDate(new Date(), 'Europe/Berlin').slice(0, 7)}-01`;
    if (m.validFrom < firstOfMonth)
      throw new BadRequestException('Gültig ab darf nicht in einem abgeschlossenen Monat liegen');
    return withSession(this.db, this.session(scope), async (tx) => {
      const [row] = await tx
        .insert(orderTypeMapping)
        .values({ ...m, changedBy: scope.userId })
        .onConflictDoUpdate({
          target: [orderTypeMapping.orderTypeCode, orderTypeMapping.validFrom],
          set: {
            category: m.category,
            productive: m.productive,
            external: m.external,
            changedBy: scope.userId,
          },
        })
        .returning();
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'SET_ORDER_TYPE_MAPPING',
        entity: 'order_type_mapping',
        entityId: row!.id,
        newValue: m,
      });
      return row;
    });
  }

  async setConfig(
    scope: AccessScope,
    c: Pick<ProductivityConfig, 'targetMin' | 'targetMax' | 'legacyMaintenanceRule'>,
  ) {
    if (c.targetMin > c.targetMax) throw new BadRequestException('Untergrenze liegt über der Obergrenze');
    return withSession(this.db, this.session(scope), async (tx) => {
      const globalRow = (await tx.select().from(setting).where(eq(setting.key, 'productivity'))).find(
        (r) => !r.locationId,
      );
      const value = { ...((globalRow?.value as object | undefined) ?? {}), ...c };
      if (globalRow) await tx.update(setting).set({ value }).where(eq(setting.id, globalRow.id));
      else await tx.insert(setting).values({ key: 'productivity', value, locationId: null });
      await this.audit.log(tx, {
        actorId: scope.userId,
        action: 'SET_PRODUCTIVITY_CONFIG',
        entity: 'setting',
        entityId: 'productivity',
        oldValue: globalRow?.value ?? null,
        newValue: value,
      });
      return value;
    });
  }
}
