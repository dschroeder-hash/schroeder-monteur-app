'use client';

import {
  ABSENCE_STATE_LABELS,
  addDays,
  localDate,
  type AbsenceState,
  type AbsenceType,
  type HalfDay,
} from '@schroeder/shared';
import { useState } from 'react';
import { absencePeriod } from '@/components/AbsenceInbox';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';

interface Row {
  id: string;
  userId: string;
  userName: string;
  locationName: string;
  type: AbsenceType;
  state: AbsenceState;
  fromDate: string;
  toDate: string | null;
  halfDay: HalfDay;
  days: number;
  bcState: 'UEBERTRAGEN' | 'AUSSTEHEND' | 'FEHLER' | null;
}
interface Person {
  userId: string;
  userName: string;
  locationId: string;
  locationName: string;
}

const field = 'min-h-touch rounded-card border border-border bg-surface px-3';
const BC: Record<NonNullable<Row['bcState']>, string> = {
  UEBERTRAGEN: 'in BC',
  AUSSTEHEND: 'Übertragung läuft',
  FEHLER: 'BC-Fehler (Admin informieren)',
};
const short = (n: string) => n.replace(/\s*\(.*\)$/, '');

/**
 * Absence overview with type for Meister (own locations) and Personal (all locations). Comments are not shown
 * here on purpose; sick reports never carry a diagnosis (PROMPT 9).
 */
export function AbsenceOverview({
  locationId,
  showLocation,
}: {
  locationId?: string;
  showLocation?: boolean;
}) {
  const today = localDate(new Date(), 'Europe/Berlin');
  const [from, setFrom] = useState(addDays(today, -14));
  const [to, setTo] = useState(addDays(today, 90));
  const [type, setType] = useState<'' | AbsenceType>('');
  const qs = `from=${from}&to=${to}${locationId ? `&locationId=${locationId}` : ''}`;
  const { data, error, reload } = useApi<Row[]>(from && to && to >= from ? `/v1/absences?${qs}` : null);
  const people = useApi<Person[]>(`/v1/absences/balances?year=${today.slice(0, 4)}`).data ?? [];
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sickFor, setSickFor] = useState({ userId: '', fromDate: today, toDate: '' });

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen' });
    }
    await reload();
  };
  const rows = (data ?? []).filter((r) => !type || r.type === type);
  const staff = people.filter((p) => !locationId || p.locationId === locationId);

  return (
    <div className="flex flex-col gap-4">
      {msg && (
        <p
          role="status"
          className={`rounded-card p-3 font-semibold ${msg.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}
        >
          {msg.text}
        </p>
      )}
      <form
        aria-labelledby="erfassen"
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            () =>
              apiFetch('/v1/absences/sick', {
                method: 'POST',
                body: JSON.stringify({
                  userId: sickFor.userId,
                  fromDate: sickFor.fromDate,
                  toDate: sickFor.toDate || null,
                }),
              }),
            'Krankmeldung erfasst – der Monteur wurde informiert.',
          ).then(() => setSickFor({ userId: '', fromDate: today, toDate: '' }));
        }}
      >
        <h2 id="erfassen" className="text-xl font-semibold">
          Krankmeldung erfassen (z. B. nach Anruf)
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 font-semibold">
            Mitarbeiter
            <select
              className={field}
              value={sickFor.userId}
              onChange={(e) => setSickFor({ ...sickFor, userId: e.target.value })}
              required
            >
              <option value="">Bitte wählen</option>
              {staff.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {short(p.userName)}
                  {showLocation ? ` (${p.locationName})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            Krank ab
            <input
              type="date"
              className={field}
              value={sickFor.fromDate}
              onChange={(e) => setSickFor({ ...sickFor, fromDate: e.target.value })}
              required
            />
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            Voraussichtlich bis
            <input
              type="date"
              className={field}
              value={sickFor.toDate}
              min={sickFor.fromDate}
              onChange={(e) => setSickFor({ ...sickFor, toDate: e.target.value })}
            />
          </label>
        </div>
        <Button type="submit" className="self-start" disabled={!sickFor.userId || !sickFor.fromDate}>
          Krankmeldung erfassen
        </Button>
      </form>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-semibold">
          Von
          <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 font-semibold">
          Bis
          <input
            type="date"
            className={field}
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 font-semibold">
          Art
          <select
            className={field}
            value={type}
            onChange={(e) => setType(e.target.value as '' | AbsenceType)}
          >
            <option value="">Alle</option>
            <option value="KRANK">Krank</option>
            <option value="URLAUB">Urlaub</option>
          </select>
        </label>
      </div>
      {error && <p className="text-danger">{error}</p>}

      <div
        tabIndex={0}
        role="region"
        aria-label="Abwesenheiten (seitlich scrollbar)"
        className="overflow-x-auto rounded-card border border-border"
      >
        <table className="w-full min-w-[40rem] text-left">
          <thead className="bg-surface-muted">
            <tr>
              <th className="p-2">Mitarbeiter</th>
              {showLocation && <th className="p-2">Standort</th>}
              <th className="p-2">Art</th>
              <th className="p-2">Zeitraum</th>
              <th className="p-2">Tage</th>
              <th className="p-2">Status</th>
              <th className="p-2">BC</th>
              <th className="p-2">
                <span className="sr-only">Aktion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2 font-semibold">{short(r.userName)}</td>
                {showLocation && <td className="p-2">{r.locationName}</td>}
                <td className="p-2">{r.type === 'KRANK' ? 'Krank' : 'Urlaub'}</td>
                <td className="p-2">{absencePeriod(r)}</td>
                <td className="p-2">{r.days.toLocaleString('de-DE')}</td>
                <td className="p-2">{ABSENCE_STATE_LABELS[r.state]}</td>
                <td className={`p-2 ${r.bcState === 'FEHLER' ? 'font-semibold text-danger' : ''}`}>
                  {r.bcState ? BC[r.bcState] : '–'}
                </td>
                <td className="p-2">
                  {r.type === 'KRANK' && r.state === 'REPORTED' && (
                    <EndDate
                      row={r}
                      onSave={(toDate) =>
                        act(
                          () =>
                            apiFetch(`/v1/absences/${r.id}/end`, {
                              method: 'POST',
                              body: JSON.stringify({ toDate }),
                            }),
                          'Ende gespeichert.',
                        )
                      }
                    />
                  )}
                </td>
              </tr>
            ))}
            {data && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-3 text-text-muted">
                  Keine Abwesenheiten im Zeitraum.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EndDate({ row, onSave }: { row: Row; onSave: (toDate: string) => Promise<void> }) {
  const [to, setTo] = useState(row.toDate ?? '');
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(to);
      }}
    >
      <label className="sr-only" htmlFor={`end-${row.id}`}>
        Ende der Krankmeldung von {row.userName}
      </label>
      <input
        id={`end-${row.id}`}
        type="date"
        className={field}
        value={to}
        min={row.fromDate}
        onChange={(e) => setTo(e.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={!to || to === row.toDate}>
        Ende speichern
      </Button>
    </form>
  );
}
