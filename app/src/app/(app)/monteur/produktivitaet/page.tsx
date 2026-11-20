'use client';

import {
  PRODUCTIVITY_CATEGORIES,
  PRODUCTIVITY_CATEGORY_LABELS,
  type ProductivityCategory,
} from '@schroeder/shared';
import { useState } from 'react';
import {
  CategoryLegend,
  hours,
  monthLabel,
  pct,
  RATING,
  StackedHours,
  TrendChart,
} from '@/components/ProductivityCharts';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useApi } from '@/lib/useApi';

interface Result {
  month: string;
  attendanceMinutes: number;
  productiveMinutes: number;
  billedMinutes: number;
  productivity: number | null;
  productivityExternal: number | null;
  travelShare: number | null;
  documentation: { finished: number; onTime: number; quota: number | null };
  target: { min: number; max: number };
  rating: 'BELOW' | 'IN' | 'ABOVE' | null;
  pendingDays: number;
  absence: { vacationDays: number; sickDays: number; holidays: number };
  byCategory: Record<ProductivityCategory, { minutes: number; productive: boolean }>;
  snapshot: boolean;
}
interface Mine {
  month: string;
  current: Result;
  previous: Result;
  trend: Array<{ month: string; productivity: number | null }>;
}

const shift = (m: string, d: number) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + d, 1)).toISOString().slice(0, 7);
};

/** Own productivity only (PROMPT 5.11). Values are computed on the server from approved days. */
export default function ProductivityPage() {
  const { me } = useAuth();
  const [month, setMonth] = useState<string | null>(null);
  const { data, error } = useApi<Mine>(
    me?.features['productivity.self'] ? `/v1/productivity/me${month ? `?month=${month}` : ''}` : null,
  );
  if (me && !me.features['productivity.self'])
    return (
      <p className="text-text-muted">
        Die Produktivitätsansicht ist für Ihren Standort nicht freigeschaltet.
      </p>
    );
  if (error) return <p className="rounded-card bg-danger-bg p-3 text-danger">{error}</p>;
  if (!data) return <p className="text-text-muted">Lädt … (nur mit Verbindung verfügbar)</p>;
  const r = data.current;
  const now = new Date().toISOString().slice(0, 7);
  const values = Object.fromEntries(
    PRODUCTIVITY_CATEGORIES.map((c) => [c, r.byCategory[c].minutes]),
  ) as Record<ProductivityCategory, number>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-headline text-2xl">Meine Produktivität</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="min-h-touch min-w-touch rounded-card border-2 border-border font-semibold"
            onClick={() => setMonth(shift(data.month, -1))}
            aria-label="Vormonat"
          >
            ‹
          </button>
          <span className="min-w-32 text-center font-semibold">{monthLabel(data.month, true)}</span>
          <button
            type="button"
            disabled={data.month >= now}
            className="min-h-touch min-w-touch rounded-card border-2 border-border font-semibold disabled:opacity-40"
            onClick={() => setMonth(shift(data.month, 1))}
            aria-label="Folgemonat"
          >
            ›
          </button>
        </div>
      </div>

      <section
        aria-labelledby="kennzahl"
        className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="kennzahl" className="text-text-muted">
          Produktivität {monthLabel(r.month, true)}
        </h2>
        <p className="font-emphasis text-5xl" data-testid="productivity">
          {pct(r.productivity)}
        </p>
        {r.rating && (
          <p className={`self-start rounded-card px-3 py-1 font-semibold ${RATING[r.rating].cls}`}>
            <span aria-hidden>{RATING[r.rating].icon} </span>
            {RATING[r.rating].text} ({pct(r.target.min)}–{pct(r.target.max)})
          </p>
        )}
        <p className="text-sm text-text-muted">
          {hours(r.productiveMinutes)} verrechnet (produktiv) ÷ {hours(r.attendanceMinutes)} Anwesenheit ·
          Vormonat {pct(data.previous.productivity)}
        </p>
        {r.pendingDays > 0 && (
          <p className="text-sm text-warning">
            {r.pendingDays} {r.pendingDays === 1 ? 'Tag ist' : 'Tage sind'} noch nicht freigegeben und{' '}
            {r.pendingDays === 1 ? 'zählt' : 'zählen'} noch nicht.
          </p>
        )}
      </section>

      <section aria-label="Weitere Kennzahlen" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Produktivität extern" value={pct(r.productivityExternal)} />
        <Kpi label="Anteil Fahrzeit" value={pct(r.travelShare)} />
        <Kpi
          label="Doku bis Folgetag"
          value={pct(r.documentation.quota)}
          hint={`${r.documentation.onTime} von ${r.documentation.finished} Aufträgen`}
        />
        <Kpi
          label="Abwesend"
          value={`${r.absence.vacationDays + r.absence.sickDays} Tage`}
          hint={`Urlaub ${r.absence.vacationDays}, krank ${r.absence.sickDays}, Feiertage ${r.absence.holidays}`}
        />
      </section>

      <section
        aria-labelledby="kategorien"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="kategorien" className="text-xl font-semibold">
          Stunden nach Kategorie
        </h2>
        <StackedHours values={values} label="Verrechnete Stunden nach Kategorie" />
        <CategoryLegend values={values} />
        <table className="text-left text-sm">
          <caption className="sr-only">Stunden nach Kategorie</caption>
          <thead>
            <tr className="text-text-muted">
              <th className="py-1 pr-3 font-normal">Kategorie</th>
              <th className="py-1 pr-3 font-normal">Stunden</th>
              <th className="py-1 font-normal">zählt produktiv</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCTIVITY_CATEGORIES.map((c) => (
              <tr key={c} className="border-t border-border">
                <td className="py-1 pr-3">{PRODUCTIVITY_CATEGORY_LABELS[c]}</td>
                <td className="py-1 pr-3">{hours(values[c])}</td>
                <td className="py-1">
                  {c === 'NACHARBEIT'
                    ? 'nein'
                    : r.byCategory[c].minutes
                      ? r.byCategory[c].productive
                        ? 'ja'
                        : 'nein'
                      : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section
        aria-labelledby="trend"
        className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="trend" className="text-xl font-semibold">
          12-Monats-Trend
        </h2>
        <TrendChart trend={data.trend} target={r.target} />
        <details>
          <summary className="min-h-touch cursor-pointer font-semibold">Als Tabelle</summary>
          <table className="text-left text-sm">
            <tbody>
              {data.trend.map((t) => (
                <tr key={t.month} className="border-t border-border">
                  <td className="py-1 pr-4">{monthLabel(t.month, true)}</td>
                  <td className="py-1">{pct(t.productivity, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <p className="text-sm text-text-muted">
        Produktivität = verrechnete Stunden produktiver Auftragsarten ÷ Anwesenheit (ohne Pausen, Schulungen
        und angeordnete Sonderaufgaben). Es zählen nur vom Meister freigegebene Tage. Diese Ansicht sehen nur
        Sie und Ihr Meister.
        {r.snapshot && ' Abgeschlossener Monat: Stand des Monatsabschlusses.'}
      </p>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}
