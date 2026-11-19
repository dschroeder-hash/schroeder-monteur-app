'use client';

import { ACTIVITY_LABELS, addDays, localDate, segmentMinutes, summarizeDay } from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fmtDate, fmtMinutes, fmtTime } from '@/lib/format';
import { kvGet, localDb } from '@/lib/offline/db';
import type { CorrectionRequest } from '@/lib/offline/sync';
import { useSync } from '@/lib/offline/SyncProvider';
import { Button } from '@/components/ui/Button';
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
  const requests =
    useLiveQuery(async () => (await kvGet<CorrectionRequest[]>(localDb, 'correctionRequests')) ?? [], []) ??
    [];
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

      {[...new Set(corrections.map((c) => c.workDate))].map((d) => (
        <ForgottenClockOut key={d} workDate={d} requests={requests.filter((r) => r.workDate === d)} />
      ))}
      {requests
        .filter((r) => r.state !== 'OFFEN' && !corrections.some((c) => c.workDate === r.workDate))
        .slice(-3)
        .map((r) => (
          <p
            key={r.id}
            role="status"
            className={`rounded-card p-3 ${r.state === 'ANGENOMMEN' ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'}`}
          >
            Korrekturantrag {fmtDate(r.workDate)}:{' '}
            {r.state === 'ANGENOMMEN'
              ? 'übernommen'
              : `abgelehnt${r.decisionReason ? ` – ${r.decisionReason}` : ''}`}
          </p>
        ))}
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

/** Mandatory correction after a forgotten clock-out (PROMPT 5.1): the Monteur proposes, the Meister approves. */
function ForgottenClockOut({ workDate, requests }: { workDate: string; requests: CorrectionRequest[] }) {
  const { run } = useSync();
  const [time, setTime] = useState('16:00');
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const open = requests.find((r) => r.state === 'OFFEN');
  const rejected = requests.filter((r) => r.state === 'ABGELEHNT').at(-1);
  if (open || sent)
    return (
      <p role="status" className="rounded-card bg-info-bg p-3 text-info">
        Ausstempeln am {fmtDate(workDate)}: Ihre Korrektur ({open?.proposal[0]?.time ?? time} Uhr) liegt beim
        Meister zur Freigabe.
      </p>
    );
  return (
    <form
      className="flex flex-col gap-2 rounded-card border-2 border-danger bg-danger-bg p-3 text-danger"
      onSubmit={(e) => {
        e.preventDefault();
        void run('RequestTimeCorrection', {
          workDate,
          proposal: [{ kind: 'CLOCK_OUT', time }],
          comment: comment || undefined,
        }).then(() => setSent(true));
      }}
    >
      <p className="font-semibold">Ausstempeln vergessen am {fmtDate(workDate)} – wann sind Sie gegangen?</p>
      {rejected && <p>Letzter Antrag abgelehnt: {rejected.decisionReason ?? 'ohne Begründung'}</p>}
      <div className="flex flex-wrap items-end gap-2 text-text">
        <label className="flex flex-col gap-1">
          Gehen um
          <input
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="min-h-touch rounded-card border border-border bg-surface px-3"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          Hinweis (optional)
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="min-h-touch rounded-card border border-border bg-surface px-3"
          />
        </label>
        <Button type="submit">An Meister senden</Button>
      </div>
    </form>
  );
}
