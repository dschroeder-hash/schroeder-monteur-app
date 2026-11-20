/**
 * Productivity engine (PROMPT 5.11, ARCHITEKTUR 3.4). Pure function, used by the API (live values and monthly
 * snapshots) – reproducible for a later bonus system: same entries + same mapping version + same config → same result.
 *
 *   Produktivität = verrechnete (produktive) Stunden ÷ Anwesenheitsstunden
 *
 *  - Anwesenheit = gestempelte Anwesenheit − Pausen − Gemeinkosten, die nicht als Anwesenheit zählen (Schulung,
 *    angeordnete Sonderaufgabe). Urlaub, Krankheit und Feiertage sind keine gestempelte Anwesenheit; sie werden nur
 *    zur Transparenz ausgewiesen.
 *  - Verrechnete Stunden = abrechenbare Minuten der Auftragszeiten (Arbeit, Diagnose, Fahrt), Kategorie über das
 *    Auftragsart-Mapping, das am Leistungstag gültig war. Nacharbeit übersteuert jede Kategorie (nicht produktiv).
 *  - Nur freigegebene Tage zählen (Standard), damit Zähler und Nenner auf derselben Basis stehen.
 */
import { addDays } from '../time/tz.js';

export const PRODUCTIVITY_CATEGORIES = [
  'KUNDENSERVICE',
  'WARTUNG_KUNDE',
  'WARTUNG_INTERN',
  'GARANTIE_KULANZ',
  'INTERN_SONSTIGE',
  'NACHARBEIT',
] as const;
export type ProductivityCategory = (typeof PRODUCTIVITY_CATEGORIES)[number];

export const PRODUCTIVITY_CATEGORY_LABELS: Record<ProductivityCategory, string> = {
  KUNDENSERVICE: 'Kundenservice',
  WARTUNG_KUNDE: 'Wartung Kunde',
  WARTUNG_INTERN: 'Wartung intern / Vertrag',
  GARANTIE_KULANZ: 'Garantie / Kulanz',
  INTERN_SONSTIGE: 'Intern sonstige',
  NACHARBEIT: 'Nacharbeit',
};

export interface MappingRule {
  orderTypeCode: string;
  category: ProductivityCategory;
  productive: boolean;
  external: boolean;
  /** YYYY-MM-DD; the rule applies from this day on (E-23). */
  validFrom: string;
}

export interface ProductivityConfig {
  /** Target corridor, e.g. 0.80–0.85 */
  targetMin: number;
  targetMax: number;
  /** Legacy data: order type KUNDE with "Wartung" in the description counts as maintenance (PROMPT 5.11). */
  legacyMaintenanceRule: boolean;
  /** Only approved days (default). false = also open days, e.g. for a provisional current month. */
  onlyApproved: boolean;
}

export const DEFAULT_PRODUCTIVITY_CONFIG: ProductivityConfig = {
  targetMin: 0.8,
  targetMax: 0.85,
  legacyMaintenanceRule: false,
  onlyApproved: true,
};

export interface ProductivityEntry {
  workDate: string;
  kind: 'ATTENDANCE' | 'ORDER' | 'OVERHEAD' | 'BREAK';
  orderId: string | null;
  activity: 'WORK' | 'TRAVEL' | 'DIAGNOSIS' | null;
  overheadCode: string | null;
  actualMinutes: number | null;
  billableMinutes: number | null;
  state: 'OPEN' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'TRANSFERRED';
}

export interface ProductivityOrder {
  orderTypeCode: string;
  description: string;
  reworkFlag: boolean;
}

/** An order the Monteur finished in the month; completedDate = day the documentation became complete. */
export interface DocumentationItem {
  orderId: string;
  finishedDate: string;
  completedDate: string | null;
}

export interface ProductivityInput {
  /** YYYY-MM */
  month: string;
  entries: readonly ProductivityEntry[];
  orders: Readonly<Record<string, ProductivityOrder>>;
  mapping: readonly MappingRule[];
  overheadTypes: ReadonlyArray<{ code: string; countsAsAttendance: boolean }>;
  documentation: readonly DocumentationItem[];
  absence?: { vacationDays: number; sickDays: number; holidays: number };
  config?: Partial<ProductivityConfig>;
}

export interface CategoryResult {
  minutes: number;
  productive: boolean;
  external: boolean;
}

export interface ProductivityResult {
  month: string;
  attendanceMinutes: number;
  breakMinutes: number;
  /** Training / ordered special tasks – excluded from attendance. */
  excludedOverheadMinutes: number;
  byCategory: Record<ProductivityCategory, CategoryResult>;
  billedMinutes: number;
  productiveMinutes: number;
  /** Productive and billed externally (customer, manufacturer). */
  externalMinutes: number;
  productivity: number | null;
  productivityExternal: number | null;
  travelMinutes: number;
  /** Travel ÷ attendance */
  travelShare: number | null;
  documentation: { finished: number; onTime: number; quota: number | null };
  target: { min: number; max: number };
  rating: 'BELOW' | 'IN' | 'ABOVE' | null;
  /** Days with stamped time that are not approved yet (not counted when onlyApproved). */
  pendingDays: number;
  approvedDays: number;
  absence: { vacationDays: number; sickDays: number; holidays: number };
  unmappedOrderTypes: string[];
  /** Latest valid_from of the mapping rules in effect (reproducibility for the bonus system). */
  mappingVersion: string;
  configHash: string;
}

const COUNTED = new Set(['APPROVED', 'TRANSFERRED']);
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** Mapping rule valid on a day: the newest rule with validFrom ≤ day. */
export function ruleFor(
  mapping: readonly MappingRule[],
  orderTypeCode: string,
  day: string,
): MappingRule | null {
  let best: MappingRule | null = null;
  for (const r of mapping)
    if (r.orderTypeCode === orderTypeCode && r.validFrom <= day && (!best || r.validFrom > best.validFrom))
      best = r;
  return best;
}

export function categorize(
  order: ProductivityOrder,
  day: string,
  mapping: readonly MappingRule[],
  config: ProductivityConfig,
): { category: ProductivityCategory; productive: boolean; external: boolean; mapped: boolean } {
  if (order.reworkFlag) return { category: 'NACHARBEIT', productive: false, external: false, mapped: true };
  let code = order.orderTypeCode;
  if (config.legacyMaintenanceRule && code === 'KUNDE' && /wartung/i.test(order.description)) {
    const maint = mapping.filter((r) => r.category === 'WARTUNG_KUNDE' && r.validFrom <= day);
    if (maint.length) code = maint.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]!.orderTypeCode;
  }
  const rule = ruleFor(mapping, code, day);
  if (!rule) return { category: 'INTERN_SONSTIGE', productive: false, external: false, mapped: false };
  return { category: rule.category, productive: rule.productive, external: rule.external, mapped: true };
}

/** Small stable hash (FNV-1a) of the effective configuration. */
export function configHash(config: ProductivityConfig): string {
  const s = JSON.stringify([
    config.targetMin,
    config.targetMax,
    config.legacyMaintenanceRule,
    config.onlyApproved,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function calculateProductivity(input: ProductivityInput): ProductivityResult {
  const config = { ...DEFAULT_PRODUCTIVITY_CONFIG, ...input.config };
  const inMonth = input.entries.filter((e) => e.workDate.startsWith(`${input.month}-`));

  // A day counts once all its entries are approved (approval is per day, PROMPT 5.3).
  const days = new Map<string, boolean>();
  for (const e of inMonth) days.set(e.workDate, (days.get(e.workDate) ?? true) && COUNTED.has(e.state));
  const counted = inMonth.filter((e) => !config.onlyApproved || days.get(e.workDate));
  const approvedDays = [...days.values()].filter(Boolean).length;

  const excluded = new Set(input.overheadTypes.filter((o) => !o.countsAsAttendance).map((o) => o.code));
  const minutes = (e: ProductivityEntry) => Math.max(0, e.actualMinutes ?? 0);
  const sum = (f: (e: ProductivityEntry) => boolean, m = minutes) =>
    counted.filter(f).reduce((a, e) => a + m(e), 0);

  const rawAttendance = sum((e) => e.kind === 'ATTENDANCE');
  const breakMinutes = sum((e) => e.kind === 'BREAK');
  const excludedOverheadMinutes = sum(
    (e) => e.kind === 'OVERHEAD' && !!e.overheadCode && excluded.has(e.overheadCode),
  );
  const attendanceMinutes = Math.max(0, rawAttendance - breakMinutes - excludedOverheadMinutes);

  const byCategory = Object.fromEntries(
    PRODUCTIVITY_CATEGORIES.map((c) => [c, { minutes: 0, productive: false, external: false }]),
  ) as Record<ProductivityCategory, CategoryResult>;
  const unmapped = new Set<string>();
  const usedRules: string[] = [];
  let productiveMinutes = 0;
  let externalMinutes = 0;
  let billedMinutes = 0;
  let travelMinutes = 0;
  for (const e of counted) {
    if (e.kind !== 'ORDER' || !e.orderId) continue;
    const order = input.orders[e.orderId];
    if (!order) continue;
    const m = Math.max(0, e.billableMinutes ?? e.actualMinutes ?? 0);
    const c = categorize(order, e.workDate, input.mapping, config);
    if (!c.mapped) unmapped.add(order.orderTypeCode);
    else {
      const rule = ruleFor(input.mapping, order.orderTypeCode, e.workDate);
      if (rule) usedRules.push(rule.validFrom);
    }
    const slot = byCategory[c.category];
    slot.minutes += m;
    slot.productive ||= c.productive;
    slot.external ||= c.external;
    billedMinutes += m;
    if (c.productive) productiveMinutes += m;
    if (c.productive && c.external) externalMinutes += m;
    if (e.activity === 'TRAVEL') travelMinutes += minutes(e);
  }

  const ratio = (a: number) => (attendanceMinutes > 0 ? round(a / attendanceMinutes) : null);
  const productivity = ratio(productiveMinutes);
  const docs = input.documentation.filter((d) => d.finishedDate.startsWith(`${input.month}-`));
  const onTime = docs.filter(
    (d) => d.completedDate !== null && d.completedDate <= addDays(d.finishedDate, 1),
  ).length;

  return {
    month: input.month,
    attendanceMinutes,
    breakMinutes,
    excludedOverheadMinutes,
    byCategory,
    billedMinutes,
    productiveMinutes,
    externalMinutes,
    productivity,
    productivityExternal: ratio(externalMinutes),
    travelMinutes,
    travelShare: ratio(travelMinutes),
    documentation: { finished: docs.length, onTime, quota: docs.length ? round(onTime / docs.length) : null },
    target: { min: config.targetMin, max: config.targetMax },
    rating:
      productivity === null
        ? null
        : productivity < config.targetMin
          ? 'BELOW'
          : productivity > config.targetMax
            ? 'ABOVE'
            : 'IN',
    pendingDays: days.size - approvedDays,
    approvedDays,
    absence: input.absence ?? { vacationDays: 0, sickDays: 0, holidays: 0 },
    unmappedOrderTypes: [...unmapped].sort(),
    mappingVersion: usedRules.sort().at(-1) ?? '',
    configHash: configHash(config),
  };
}

/** Sums several results (e.g. location total): ratios are recomputed from the minute sums, never averaged. */
export function sumProductivity(month: string, results: readonly ProductivityResult[]): ProductivityResult {
  const base = calculateProductivity({
    month,
    entries: [],
    orders: {},
    mapping: [],
    overheadTypes: [],
    documentation: [],
  });
  const out = results.reduce<ProductivityResult>((acc, r) => {
    for (const c of PRODUCTIVITY_CATEGORIES) {
      acc.byCategory[c].minutes += r.byCategory[c].minutes;
      acc.byCategory[c].productive ||= r.byCategory[c].productive;
      acc.byCategory[c].external ||= r.byCategory[c].external;
    }
    acc.attendanceMinutes += r.attendanceMinutes;
    acc.breakMinutes += r.breakMinutes;
    acc.excludedOverheadMinutes += r.excludedOverheadMinutes;
    acc.billedMinutes += r.billedMinutes;
    acc.productiveMinutes += r.productiveMinutes;
    acc.externalMinutes += r.externalMinutes;
    acc.travelMinutes += r.travelMinutes;
    acc.documentation.finished += r.documentation.finished;
    acc.documentation.onTime += r.documentation.onTime;
    acc.pendingDays += r.pendingDays;
    acc.approvedDays += r.approvedDays;
    acc.absence.vacationDays += r.absence.vacationDays;
    acc.absence.sickDays += r.absence.sickDays;
    acc.absence.holidays += r.absence.holidays;
    acc.unmappedOrderTypes = [...new Set([...acc.unmappedOrderTypes, ...r.unmappedOrderTypes])].sort();
    acc.target = r.target;
    acc.configHash = r.configHash;
    if (r.mappingVersion > acc.mappingVersion) acc.mappingVersion = r.mappingVersion;
    return acc;
  }, base);
  const ratio = (a: number) => (out.attendanceMinutes > 0 ? round(a / out.attendanceMinutes) : null);
  out.productivity = ratio(out.productiveMinutes);
  out.productivityExternal = ratio(out.externalMinutes);
  out.travelShare = ratio(out.travelMinutes);
  out.documentation.quota = out.documentation.finished
    ? round(out.documentation.onTime / out.documentation.finished)
    : null;
  out.rating =
    out.productivity === null
      ? null
      : out.productivity < out.target.min
        ? 'BELOW'
        : out.productivity > out.target.max
          ? 'ABOVE'
          : 'IN';
  return out;
}
