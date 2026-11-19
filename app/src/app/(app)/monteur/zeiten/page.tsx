'use client';

import { ACTIVITY_LABELS, addDays, localDate, segmentMinutes, summarizeDay } from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fmtDate, fmtMinutes, fmtTime } from '@/lib/format';
import { localDb } from '@/lib/offline/db';
import { useNow, useSegments, useTimezone } from '@/lib/offline/hooks';

const KIND_LABEL = {
  ATTENDANCE: 'Anwesenheit',
  ORDER: 'Auftrag',
  OVERHEAD: 'Gemeinkosten',
  BREAK: 'Pause',
} as const;

/** Own times only: day summary with ArbZG warnings (warn, never block), segments, last 14 days. Computed locally. */
export default function TimesPage() {
  const { me } = useAuth();
  const tz = useTimezone();
  const now = useNow();
  const segments = useSegments(me?.id);
  const today = localDate(now, tz);
  const [day, setDay] = useState(today);
  const orders = useLiveQuery(() => localDb.orders.toArray(), []) ?? [];
  const overheads = useLiveQuery(() => localDb.overheadTypes.toArray(), []) ?? [];
  const rejected = useLiveQuery(() => localDb.outbox.where('status').equals('rejected').toArray(), []) ?? [];
  const corrections =
    useLiveQuery(
      () => localDb.timeEntries.filter((e) => e.needsCorrection && e.userId === me?.id).toArray(),
      [me?.id],
    ) ?? [];

  const prevEnd = (d: string) =>
    segments
      .filter((s) => s.kind === 'ATTENDANCE' && s.workDate < d && s.end)
      .map((s) => s.end!)
      .sort()
      .at(-1);
  const sum = summarizeDay(day, segments, { previousAttendanceEnd: prevEnd(day), now });
  const daySegs = segments.filter((s) => s.workDate === day && s.kind !== 'ATTENDANCE');
  const orderNo = (id: string | null) => orders.find((o) => o.id === id)?.bcNo ?? 'Auftrag';
  const last = Array.from({ length: 14 }, (_, i) => addDays(today, -i))
    .map((d) => summarizeDay(d, segments, { now }))
    .filter((s) => s.attendanceMinutes > 0);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-headline text-2xl">Meine Zeiten</h1>

      {corrections.length > 0 && (
        <p role="alert" className="rounded-card bg-danger-bg p-3 font-semibold text-danger">
          Ausstempeln vergessen am {[...new Set(corrections.map((c) => fmtDate(c.workDate)))].join(', ')} –
          bitte Endzeit an Ihren Meister melden. Die Korrektur gibt der Meister frei.
        </p>
      )}
      {rejected.map((r) => (
        <p key={r.id} role="alert" className="rounded-card bg-danger-bg p-3 text-danger">
          Nicht übernommen ({new Date(r.deviceTime).toLocaleString('de-DE')}): {r.error}
        </p>
      ))}

      <div className="flex items-center justify-between gap-2">
        <button
          className="min-h-touch min-w-touch rounded-card border border-border px-3 font-semibold"
          onClick={() => setDay(addDays(day, -1))}
          aria-label="Vortag"
        >
          ←
        </button>
        <span className="font-semibold">{day === today ? 'Heute' : fmtDate(day)}</span>
        <button
          className="min-h-touch min-w-touch rounded-card border border-border px-3 font-semibold disabled:opacity-40"
          disabled={day >= today}
          onClick={() => setDay(addDays(day, 1))}
          aria-label="Folgetag"
        >
          →
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Anwesenheit', sum.attendanceMinutes],
          ['Pausen', sum.breakMinutes],
          ['Arbeitszeit', sum.workMinutes],
          ['Auf Aufträgen', sum.orderMinutes],
          ['davon Fahrzeit', sum.travelMinutes],
          ['Gemeinkosten', sum.overheadMinutes],
          ['Nicht zugeordnet', sum.unassignedMinutes],
        ].map(([label, m]) => (
          <div key={label as string} className="rounded-card border border-border bg-surface p-3">
            <dt className="text-sm text-text-muted">{label}</dt>
            <dd className="font-emphasis text-xl tabular-nums">{fmtMinutes(m as number)}</dd>
          </div>
        ))}
      </dl>

      {sum.warnings.length > 0 && (
        <section aria-label="Hinweise Arbeitszeitgesetz" className="flex flex-col gap-2">
          {sum.warnings.map((w) => (
            <p key={w.code} className="rounded-card bg-warning-bg p-3 text-warning">
              ⚠ {w.message}
            </p>
          ))}
        </section>
      )}

      <section aria-labelledby="buchungen">
        <h2 id="buchungen" className="mb-2 font-semibold">
          Buchungen
        </h2>
        <ol className="flex flex-col gap-2">
          {daySegs.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-card border border-border bg-surface p-3"
            >
              <span>
                <span className="tabular-nums">
                  {fmtTime(s.start, tz)}–{s.end ? fmtTime(s.end, tz) : 'läuft'}
                </span>{' '}
                ·{' '}
                {s.kind === 'ORDER'
                  ? `${orderNo(s.orderId)} · ${ACTIVITY_LABELS[s.activity!]}`
                  : s.kind === 'OVERHEAD'
                    ? (overheads.find((o) => o.code === s.overheadCode)?.label ?? s.overheadCode)
                    : KIND_LABEL[s.kind]}
              </span>
              <span className="font-semibold tabular-nums">{fmtMinutes(segmentMinutes(s, now))}</span>
            </li>
          ))}
          {daySegs.length === 0 && <li className="text-text-muted">Keine Buchungen.</li>}
        </ol>
      </section>

      <section aria-labelledby="verlauf">
        <h2 id="verlauf" className="mb-2 font-semibold">
          Letzte 14 Tage
        </h2>
        <table className="w-full text-left">
          <thead className="text-sm text-text-muted">
            <tr>
              <th className="py-1">Tag</th>
              <th>Arbeitszeit</th>
              <th>Aufträge</th>
              <th>Hinweise</th>
            </tr>
          </thead>
          <tbody>
            {last.map((s) => (
              <tr key={s.workDate} className="border-t border-border">
                <td className="py-2">
                  <button className="underline" onClick={() => setDay(s.workDate)}>
                    {fmtDate(s.workDate)}
                  </button>
                </td>
                <td className="tabular-nums">{fmtMinutes(s.workMinutes)}</td>
                <td className="tabular-nums">{fmtMinutes(s.orderMinutes)}</td>
                <td>{s.warnings.length ? `⚠ ${s.warnings.length}` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
