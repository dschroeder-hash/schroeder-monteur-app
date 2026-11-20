'use client';

import { PRODUCTIVITY_CATEGORIES, type ProductivityCategory } from '@schroeder/shared';
import { useState } from 'react';
import {
  CategoryLegend,
  hours,
  monthLabel,
  pct,
  RATING,
  StackedHours,
} from '@/components/ProductivityCharts';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useMeisterLocations } from '@/lib/meister';
import { useApi } from '@/lib/useApi';

interface Result {
  attendanceMinutes: number;
  productiveMinutes: number;
  productivity: number | null;
  productivityExternal: number | null;
  travelShare: number | null;
  documentation: { finished: number; onTime: number; quota: number | null };
  target: { min: number; max: number };
  rating: 'BELOW' | 'IN' | 'ABOVE' | null;
  pendingDays: number;
  byCategory: Record<ProductivityCategory, { minutes: number }>;
}
interface Team {
  month: string;
  location: { name: string };
  monteure: Array<{
    userId: string;
    name: string;
    isApprentice: boolean;
    current: Result;
    previousProductivity: number | null;
  }>;
  total: Result;
}

const shift = (m: string, d: number) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + d, 1)).toISOString().slice(0, 7);
};
const values = (r: Result) =>
  Object.fromEntries(PRODUCTIVITY_CATEGORIES.map((c) => [c, r.byCategory[c].minutes])) as Record<
    ProductivityCategory,
    number
  >;

/** Team view (PROMPT 5.11): same figures per Monteur of the location plus location total. */
export default function TeamProductivityPage() {
  const { me } = useAuth();
  const loc = useMeisterLocations()[0]?.id;
  const [month, setMonth] = useState<string | null>(null);
  const { data, error } = useApi<Team>(
    loc ? `/v1/productivity/team?locationId=${loc}${month ? `&month=${month}` : ''}` : null,
  );
  if (me && !me.features['productivity.team'])
    return (
      <p className="text-text-muted">
        Die Teamansicht Produktivität ist für Ihren Standort nicht freigeschaltet.
      </p>
    );
  if (error) return <p className="rounded-card bg-danger-bg p-3 text-danger">{error}</p>;
  if (!data) return <p className="text-text-muted">Lädt …</p>;
  const now = new Date().toISOString().slice(0, 7);
  const rows = [
    ...data.monteure.map((m) => ({
      key: m.userId,
      name: m.name.replace(/\s*\(.*\)$/, ''),
      azubi: m.isApprentice,
      r: m.current,
      prev: m.previousProductivity,
    })),
    {
      key: 'total',
      name: `${data.location.name} gesamt`,
      azubi: false,
      r: data.total,
      prev: null as number | null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-headline text-2xl">Produktivität Team</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Vormonat"
            className="min-h-touch min-w-touch rounded-card border-2 border-border font-semibold"
            onClick={() => setMonth(shift(data.month, -1))}
          >
            ‹
          </button>
          <span className="min-w-32 text-center font-semibold">{monthLabel(data.month, true)}</span>
          <button
            type="button"
            aria-label="Folgemonat"
            disabled={data.month >= now}
            className="min-h-touch min-w-touch rounded-card border-2 border-border font-semibold disabled:opacity-40"
            onClick={() => setMonth(shift(data.month, 1))}
          >
            ›
          </button>
        </div>
      </div>
      <p className="text-sm text-text-muted">
        Zielkorridor {pct(data.total.target.min)}–{pct(data.total.target.max)}. Es zählen nur freigegebene
        Tage; die Standortsumme wird aus den Stunden berechnet, nicht als Mittelwert.
      </p>
      <CategoryLegend />
      <div
        tabIndex={0}
        role="region"
        aria-label="Produktivität je Monteur (seitlich scrollbar)"
        className="overflow-x-auto rounded-card border border-border bg-surface"
      >
        <table className="w-full min-w-[56rem] text-left">
          <thead className="bg-surface-muted">
            <tr>
              <th className="p-2">Monteur</th>
              <th className="p-2">Produktivität</th>
              <th className="p-2">Vormonat</th>
              <th className="p-2">extern</th>
              <th className="p-2">Fahrzeit</th>
              <th className="p-2">Doku bis Folgetag</th>
              <th className="p-2">Anwesenheit</th>
              <th className="w-64 p-2">Stunden nach Kategorie</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, name, azubi, r, prev }) => (
              <tr
                key={key}
                className={`border-t border-border ${key === 'total' ? 'bg-surface-muted font-semibold' : ''}`}
              >
                <td className="p-2">
                  {name}
                  {azubi && <span className="ml-1 text-xs text-text-muted">Azubi</span>}
                  {r.pendingDays > 0 && (
                    <p className="text-xs font-normal text-warning">{r.pendingDays} Tage offen</p>
                  )}
                </td>
                <td className="p-2">
                  {pct(r.productivity)}
                  {r.rating && (
                    <span className={`ml-2 whitespace-nowrap rounded px-1 text-xs ${RATING[r.rating].cls}`}>
                      <span aria-hidden>{RATING[r.rating].icon}</span> {RATING[r.rating].text}
                    </span>
                  )}
                </td>
                <td className="p-2">{key === 'total' ? '' : pct(prev)}</td>
                <td className="p-2">{pct(r.productivityExternal)}</td>
                <td className="p-2">{pct(r.travelShare)}</td>
                <td className="p-2">
                  {pct(r.documentation.quota)}
                  {r.documentation.finished > 0 && (
                    <span className="text-xs text-text-muted">
                      {' '}
                      ({r.documentation.onTime}/{r.documentation.finished})
                    </span>
                  )}
                </td>
                <td className="p-2">{hours(r.attendanceMinutes)}</td>
                <td className="p-2">
                  <StackedHours values={values(r)} height={16} label={`Stunden ${name}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
