'use client';

import { useState } from 'react';
import { AbsenceOverview } from '@/components/AbsenceOverview';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';

interface Balance {
  userId: string;
  userName: string;
  locationName: string;
  entitlement: number;
  carryOver: number;
  taken: number;
  requested: number;
  remaining: number;
}

/**
 * Personal (PROMPT 4): absences across all locations (sick reports without diagnosis, vacation) and the vacation
 * entitlement as long as the remaining vacation is maintained in the app (OFFENE-PUNKTE OP-03).
 */
export default function PersonalPage() {
  const [tab, setTab] = useState<'abwesenheiten' | 'urlaubskonten'>('abwesenheiten');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-headline text-2xl">Personal</h1>
      <div role="tablist" aria-label="Bereich" className="flex gap-2">
        {(
          [
            ['abwesenheiten', 'Abwesenheiten'],
            ['urlaubskonten', 'Urlaubskonten'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-touch rounded-card px-4 font-semibold ${tab === k ? 'bg-primary text-on-primary' : 'border-2 border-border bg-surface'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'abwesenheiten' ? <AbsenceOverview showLocation /> : <Balances />}
    </div>
  );
}

function Balances() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, reload } = useApi<Balance[]>(`/v1/absences/balances?year=${year}`);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (b: Balance, entitlementDays: number, carryOverDays: number) => {
    try {
      await apiFetch('/v1/absences/balances', {
        method: 'PUT',
        body: JSON.stringify({ userId: b.userId, year, entitlementDays, carryOverDays }),
      });
      setMsg(`Urlaubskonto ${b.userName.replace(/\s*\(.*\)$/, '')} gespeichert.`);
      await reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen');
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <label className="flex w-40 flex-col gap-1 font-semibold">
        Jahr
        <input
          type="number"
          className="min-h-touch rounded-card border border-border bg-surface px-3"
          value={year}
          min={2020}
          max={2100}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </label>
      {msg && (
        <p role="status" className="rounded-card bg-surface-muted p-3 font-semibold">
          {msg}
        </p>
      )}
      <div
        tabIndex={0}
        role="region"
        aria-label="Urlaubskonten (seitlich scrollbar)"
        className="overflow-x-auto rounded-card border border-border"
      >
        <table className="w-full min-w-[44rem] text-left">
          <thead className="bg-surface-muted">
            <tr>
              <th className="p-2">Mitarbeiter</th>
              <th className="p-2">Standort</th>
              <th className="p-2">Anspruch</th>
              <th className="p-2">Übertrag</th>
              <th className="p-2">Genehmigt</th>
              <th className="p-2">Beantragt</th>
              <th className="p-2">Rest</th>
              <th className="p-2">
                <span className="sr-only">Speichern</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((b) => (
              <BalanceRow key={`${b.userId}-${year}`} b={b} onSave={save} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BalanceRow({
  b,
  onSave,
}: {
  b: Balance;
  onSave: (b: Balance, e: number, c: number) => Promise<void>;
}) {
  const [ent, setEnt] = useState(String(b.entitlement));
  const [carry, setCarry] = useState(String(b.carryOver));
  const name = b.userName.replace(/\s*\(.*\)$/, '');
  const num = 'min-h-touch w-20 rounded-card border border-border bg-surface px-2';
  return (
    <tr className="border-t border-border">
      <td className="p-2 font-semibold">{name}</td>
      <td className="p-2">{b.locationName}</td>
      <td className="p-2">
        <input
          aria-label={`Anspruch ${name}`}
          type="number"
          step="0.5"
          min="0"
          max="60"
          className={num}
          value={ent}
          onChange={(e) => setEnt(e.target.value)}
        />
      </td>
      <td className="p-2">
        <input
          aria-label={`Übertrag ${name}`}
          type="number"
          step="0.5"
          min="0"
          max="60"
          className={num}
          value={carry}
          onChange={(e) => setCarry(e.target.value)}
        />
      </td>
      <td className="p-2">{b.taken.toLocaleString('de-DE')}</td>
      <td className="p-2">{b.requested.toLocaleString('de-DE')}</td>
      <td className={`p-2 font-semibold ${b.remaining < 0 ? 'text-danger' : ''}`}>
        {b.remaining.toLocaleString('de-DE')}
      </td>
      <td className="p-2">
        <Button
          variant="secondary"
          disabled={Number(ent) === b.entitlement && Number(carry) === b.carryOver}
          onClick={() => void onSave(b, Number(ent), Number(carry))}
        >
          Speichern
        </Button>
      </td>
    </tr>
  );
}
