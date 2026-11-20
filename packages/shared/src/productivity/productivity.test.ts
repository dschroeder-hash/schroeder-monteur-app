/**
 * Reference cases for the productivity engine (PROMPT 5.11, DoD "Unit-Tests mit Referenzfällen").
 * Every expected value is calculated by hand in the comments.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateProductivity,
  sumProductivity,
  type MappingRule,
  type ProductivityEntry,
  type ProductivityInput,
} from './productivity.js';

const MAPPING: MappingRule[] = [
  {
    orderTypeCode: 'KUNDE',
    category: 'KUNDENSERVICE',
    productive: true,
    external: true,
    validFrom: '2020-01-01',
  },
  {
    orderTypeCode: 'KLEING',
    category: 'KUNDENSERVICE',
    productive: true,
    external: true,
    validFrom: '2020-01-01',
  },
  {
    orderTypeCode: 'WARTUNG',
    category: 'WARTUNG_KUNDE',
    productive: true,
    external: true,
    validFrom: '2020-01-01',
  },
  {
    orderTypeCode: 'INTWART',
    category: 'WARTUNG_INTERN',
    productive: true,
    external: false,
    validFrom: '2020-01-01',
  },
  {
    orderTypeCode: 'GARANTIE',
    category: 'GARANTIE_KULANZ',
    productive: true,
    external: true,
    validFrom: '2020-01-01',
  },
  {
    orderTypeCode: 'KULANZ',
    category: 'GARANTIE_KULANZ',
    productive: true,
    external: false,
    validFrom: '2020-01-01',
  },
  // From 6 Oct goodwill no longer counts (mapping version change)
  {
    orderTypeCode: 'KULANZ',
    category: 'GARANTIE_KULANZ',
    productive: false,
    external: false,
    validFrom: '2026-10-06',
  },
  {
    orderTypeCode: 'GEBR',
    category: 'INTERN_SONSTIGE',
    productive: false,
    external: false,
    validFrom: '2020-01-01',
  },
];
const OVERHEAD = [
  { code: 'WERKSTATTPFLEGE', countsAsAttendance: true },
  { code: 'SCHULUNG', countsAsAttendance: false },
  { code: 'SONDERAUFGABE', countsAsAttendance: false },
];
const ORDERS = {
  kunde: { orderTypeCode: 'KUNDE', description: 'Hydraulik undicht', reworkFlag: false },
  wartung: { orderTypeCode: 'WARTUNG', description: 'Wartung 1000 h', reworkFlag: false },
  intwart: { orderTypeCode: 'INTWART', description: 'Wartungsvertrag', reworkFlag: false },
  gebr: { orderTypeCode: 'GEBR', description: 'Aufbereitung Gebrauchtmaschine', reworkFlag: false },
  nacharbeit: { orderTypeCode: 'KUNDE', description: 'Hydraulik erneut undicht', reworkFlag: true },
  kulanz: { orderTypeCode: 'KULANZ', description: 'Kulanz Kupplung', reworkFlag: false },
  altWartung: { orderTypeCode: 'KUNDE', description: 'Wartung 500 h (Altdaten)', reworkFlag: false },
  unbekannt: { orderTypeCode: 'MIETE', description: 'Mietmaschine', reworkFlag: false },
};

const e = (
  workDate: string,
  kind: ProductivityEntry['kind'],
  minutes: number,
  extra: Partial<ProductivityEntry> = {},
): ProductivityEntry => ({
  workDate,
  kind,
  orderId: null,
  activity: kind === 'ORDER' ? 'WORK' : null,
  overheadCode: null,
  actualMinutes: minutes,
  billableMinutes: kind === 'ORDER' ? minutes : null,
  state: 'APPROVED',
  ...extra,
});

/** Day 1: 9 h present, 30 min break, 30 min training → 480 min attendance; 420 min productive. */
const DAY1 = [
  e('2026-10-05', 'ATTENDANCE', 540),
  e('2026-10-05', 'BREAK', 30),
  e('2026-10-05', 'ORDER', 240, { orderId: 'kunde' }),
  e('2026-10-05', 'ORDER', 60, { orderId: 'kunde', activity: 'TRAVEL' }),
  e('2026-10-05', 'ORDER', 120, { orderId: 'wartung' }),
  e('2026-10-05', 'OVERHEAD', 60, { overheadCode: 'WERKSTATTPFLEGE' }),
  e('2026-10-05', 'OVERHEAD', 30, { overheadCode: 'SCHULUNG' }),
];
/** Day 2: 8 h present, 30 min break → 450 min attendance; only INTWART (180) is productive. */
const DAY2 = [
  e('2026-10-06', 'ATTENDANCE', 480, { state: 'TRANSFERRED' }),
  e('2026-10-06', 'BREAK', 30, { state: 'TRANSFERRED' }),
  e('2026-10-06', 'ORDER', 180, { orderId: 'intwart', state: 'TRANSFERRED' }),
  e('2026-10-06', 'ORDER', 120, { orderId: 'gebr', state: 'TRANSFERRED' }),
  e('2026-10-06', 'ORDER', 60, { orderId: 'nacharbeit', state: 'TRANSFERRED' }),
  e('2026-10-06', 'OVERHEAD', 90, { overheadCode: 'WERKSTATTPFLEGE', state: 'TRANSFERRED' }),
];
const base = (over: Partial<ProductivityInput> = {}): ProductivityInput => ({
  month: '2026-10',
  entries: [...DAY1, ...DAY2],
  orders: ORDERS,
  mapping: MAPPING,
  overheadTypes: OVERHEAD,
  documentation: [],
  ...over,
});

describe('Referenzfall 1: normaler Monat', () => {
  const r = calculateProductivity(base());
  it('Anwesenheit = gestempelt − Pausen − Schulung', () => {
    expect(r.attendanceMinutes).toBe(480 + 450); // (540−30−30) + (480−30)
    expect(r.breakMinutes).toBe(60);
    expect(r.excludedOverheadMinutes).toBe(30);
  });
  it('Stunden je Kategorie über das Auftragsart-Mapping; Nacharbeit übersteuert', () => {
    expect(r.byCategory.KUNDENSERVICE.minutes).toBe(300); // 240 Arbeit + 60 Fahrt
    expect(r.byCategory.WARTUNG_KUNDE.minutes).toBe(120);
    expect(r.byCategory.WARTUNG_INTERN.minutes).toBe(180);
    expect(r.byCategory.INTERN_SONSTIGE.minutes).toBe(120);
    expect(r.byCategory.NACHARBEIT).toEqual({ minutes: 60, productive: false, external: false });
    expect(r.billedMinutes).toBe(780);
  });
  it('Produktivität = produktiv ÷ Anwesenheit', () => {
    expect(r.productiveMinutes).toBe(600); // 300 + 120 + 180
    expect(r.productivity).toBe(0.6452); // 600 / 930
    expect(r.externalMinutes).toBe(420); // Wartung intern zählt produktiv, aber nicht extern
    expect(r.productivityExternal).toBe(0.4516); // 420 / 930
    expect(r.rating).toBe('BELOW');
  });
  it('Fahrzeitanteil = Fahrzeit ÷ Anwesenheit', () => {
    expect(r.travelMinutes).toBe(60);
    expect(r.travelShare).toBe(0.0645);
  });
  it('macht das Ergebnis reproduzierbar (Mapping-Version, Konfigurations-Hash)', () => {
    expect(r.mappingVersion).toBe('2020-01-01');
    expect(r.configHash).toMatch(/^[0-9a-f]{8}$/);
    expect(calculateProductivity(base())).toEqual(r);
  });
});

describe('Referenzfall 2: Zielkorridor', () => {
  it('Tag 1 allein liegt über dem Korridor 80–85 %', () => {
    const r = calculateProductivity(base({ entries: DAY1 }));
    expect(r.productivity).toBe(0.875); // 420 / 480
    expect(r.rating).toBe('ABOVE');
  });
  it('konfigurierbares Ziel', () => {
    const r = calculateProductivity(base({ entries: DAY1, config: { targetMin: 0.85, targetMax: 0.9 } }));
    expect(r.rating).toBe('IN');
    expect(r.target).toEqual({ min: 0.85, max: 0.9 });
    expect(r.configHash).not.toBe(calculateProductivity(base({ entries: DAY1 })).configHash);
  });
});

describe('Referenzfall 3: nur freigegebene Tage', () => {
  const open = [
    e('2026-10-07', 'ATTENDANCE', 480, { state: 'OPEN' }),
    e('2026-10-07', 'ORDER', 450, { orderId: 'kunde', state: 'OPEN' }),
  ];
  it('ein offener Tag zählt nicht, wird aber ausgewiesen', () => {
    const r = calculateProductivity(base({ entries: [...DAY1, ...open] }));
    expect(r.attendanceMinutes).toBe(480);
    expect(r.pendingDays).toBe(1);
    expect(r.approvedDays).toBe(1);
  });
  it('vorläufige Sicht mit offenen Tagen', () => {
    const r = calculateProductivity(base({ entries: [...DAY1, ...open], config: { onlyApproved: false } }));
    expect(r.attendanceMinutes).toBe(960);
    expect(r.productiveMinutes).toBe(870);
  });
  it('ein Tag mit einem einzigen offenen Eintrag zählt ganz nicht', () => {
    const mixed = [...DAY1.slice(0, 2), { ...DAY1[2]!, state: 'SUBMITTED' as const }, ...DAY1.slice(3)];
    expect(calculateProductivity(base({ entries: mixed })).attendanceMinutes).toBe(0);
  });
});

describe('Referenzfall 4: Mapping-Versionen', () => {
  it('es gilt die Regel des Leistungstags', () => {
    const r = calculateProductivity(
      base({
        entries: [
          e('2026-10-05', 'ATTENDANCE', 240),
          e('2026-10-05', 'ORDER', 120, { orderId: 'kulanz' }),
          e('2026-10-06', 'ATTENDANCE', 240),
          e('2026-10-06', 'ORDER', 120, { orderId: 'kulanz' }),
        ],
      }),
    );
    expect(r.byCategory.GARANTIE_KULANZ.minutes).toBe(240);
    expect(r.productiveMinutes).toBe(120); // nur der 5.10.
    expect(r.productivity).toBe(0.25);
    expect(r.mappingVersion).toBe('2026-10-06');
  });
});

describe('Referenzfall 5: Altdaten-Regel „Wartung“ im Titel', () => {
  const entries = [
    e('2026-10-05', 'ATTENDANCE', 480),
    e('2026-10-05', 'ORDER', 240, { orderId: 'altWartung' }),
  ];
  it('aus: Kundenservice', () => {
    expect(calculateProductivity(base({ entries })).byCategory.KUNDENSERVICE.minutes).toBe(240);
  });
  it('an: Wartung Kunde', () => {
    const r = calculateProductivity(base({ entries, config: { legacyMaintenanceRule: true } }));
    expect(r.byCategory.WARTUNG_KUNDE.minutes).toBe(240);
    expect(r.byCategory.KUNDENSERVICE.minutes).toBe(0);
  });
});

describe('Referenzfall 6: Dokumentationsquote bis Ende des Folgetags', () => {
  it('zählt nur im Monat abgeschlossene Aufträge', () => {
    const r = calculateProductivity(
      base({
        documentation: [
          { orderId: 'a', finishedDate: '2026-10-05', completedDate: '2026-10-06' }, // rechtzeitig
          { orderId: 'b', finishedDate: '2026-10-07', completedDate: '2026-10-09' }, // zu spät
          { orderId: 'c', finishedDate: '2026-10-08', completedDate: null }, // offen
          { orderId: 'd', finishedDate: '2026-09-30', completedDate: '2026-09-30' }, // Vormonat
          { orderId: 'e', finishedDate: '2026-10-31', completedDate: '2026-10-31' }, // am selben Tag
        ],
      }),
    );
    expect(r.documentation).toEqual({ finished: 4, onTime: 2, quota: 0.5 });
  });
});

describe('Referenzfall 7: Sonderfälle', () => {
  it('unbekannte Auftragsart → Intern sonstige, nicht produktiv, ausgewiesen', () => {
    const r = calculateProductivity(
      base({
        entries: [e('2026-10-05', 'ATTENDANCE', 480), e('2026-10-05', 'ORDER', 60, { orderId: 'unbekannt' })],
      }),
    );
    expect(r.byCategory.INTERN_SONSTIGE.minutes).toBe(60);
    expect(r.productiveMinutes).toBe(0);
    expect(r.unmappedOrderTypes).toEqual(['MIETE']);
  });
  it('ohne Anwesenheit keine Kennzahl', () => {
    const r = calculateProductivity(base({ entries: [] }));
    expect(r.productivity).toBeNull();
    expect(r.rating).toBeNull();
  });
  it('gerundete abrechenbare Minuten zählen, nicht die Ist-Zeit', () => {
    const r = calculateProductivity(
      base({
        entries: [
          e('2026-10-05', 'ATTENDANCE', 480),
          e('2026-10-05', 'ORDER', 52, { orderId: 'kunde', billableMinutes: 60 }),
        ],
      }),
    );
    expect(r.productiveMinutes).toBe(60);
  });
  it('Einträge anderer Monate werden ignoriert', () => {
    const r = calculateProductivity(base({ entries: [e('2026-11-02', 'ATTENDANCE', 480)] }));
    expect(r.attendanceMinutes).toBe(0);
  });
});

describe('Referenzfall 8: Standortsumme', () => {
  it('Quote aus Minutensummen, nicht Mittelwert der Quoten', () => {
    const a = calculateProductivity(base({ entries: DAY1 })); // 420 / 480
    const b = calculateProductivity(base({ entries: DAY2 })); // 180 / 450
    const s = sumProductivity('2026-10', [a, b]);
    expect(s.productiveMinutes).toBe(600);
    expect(s.attendanceMinutes).toBe(930);
    expect(s.productivity).toBe(0.6452); // ≠ (0.875 + 0.4) / 2
    expect(s.byCategory.KUNDENSERVICE.minutes).toBe(300);
    expect(s.rating).toBe('BELOW');
  });
});
