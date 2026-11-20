'use client';

import { ACTIVITY_LABELS, localTime, type Activity, type DaySummary } from '@schroeder/shared';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { AbsenceInbox, type InboxAbsence } from '@/components/AbsenceInbox';
import { apiFetch, ApiError } from '@/lib/api';
import { fmtDate, fmtMinutes } from '@/lib/format';
import { useMeisterLocations } from '@/lib/meister';

interface InboxDay {
  userId: string;
  userName: string;
  workDate: string;
  summary: DaySummary;
  needsCorrection: boolean;
  skewFlag: boolean;
  running: boolean;
  approvable: boolean;
  orders: Array<{
    orderId: string;
    activity: Activity;
    minutes: number;
    bcNo?: string;
    customerName?: string;
  }>;
}
interface CorrectionReq {
  id: string;
  userId: string;
  userName: string;
  workDate: string;
  proposal: Array<{ kind: string; time: string }>;
  comment: string | null;
}
interface Consumption {
  id: string;
  orderId: string | null;
  bcNo: string | null;
  customerName: string | null;
  userName: string;
  itemNumber: string;
  itemName: string;
  quantity: number;
  unit: string;
  storage: string;
  internalPurpose: string | null;
  costCenter: string | null;
  stockConflict: boolean;
  meterPlausible: boolean;
  deviceTime: string;
}
interface Inbox {
  absences: InboxAbsence[];
  consumptions: Consumption[];
  days: InboxDay[];
  corrections: CorrectionReq[];
  orders: Array<{ id: string; bcNo: string; customerName: string; description: string }>;
}
interface DayEvent {
  id: string;
  kind: string;
  deviceTime: string;
  orderId: string | null;
  activity: Activity | null;
  createdBy: string | null;
  correctionReason: string | null;
  voided: boolean;
}

const KIND_LABEL: Record<string, string> = {
  CLOCK_IN: 'Kommen',
  CLOCK_OUT: 'Gehen',
  JOB_START: 'Auftrag Start',
  JOB_PAUSE: 'Auftrag Pause',
  JOB_STOP: 'Auftrag Stopp',
  OVERHEAD_START: 'Gemeinkosten Start',
  OVERHEAD_STOP: 'Gemeinkosten Stopp',
  BREAK_START: 'Pause Beginn',
  BREAK_STOP: 'Pause Ende',
};

/** Approval inbox (PROMPT 5.3): times per Monteur and day, correction requests, finished orders. */
export default function ApprovalsPage() {
  const locations = useMeisterLocations();
  const locationId = locations[0]?.id;
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [correcting, setCorrecting] = useState<InboxDay | null>(null);

  const load = useCallback(async () => {
    if (locationId) setInbox(await apiFetch<Inbox>(`/v1/approvals/inbox?locationId=${locationId}`));
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen' });
    }
    await load();
  };

  const byUser = new Map<string, InboxDay[]>();
  for (const d of inbox?.days ?? []) byUser.set(d.userName, [...(byUser.get(d.userName) ?? []), d]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-headline text-2xl">Freigaben</h1>
      {msg && (
        <p
          role="status"
          className={`rounded-card p-3 font-semibold ${msg.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}
        >
          {msg.text}
        </p>
      )}

      {!!inbox?.absences.length && <AbsenceInbox items={inbox.absences} act={act} />}

      {!!inbox?.corrections.length && (
        <section aria-labelledby="korr" className="flex flex-col gap-2">
          <h2 id="korr" className="text-xl font-semibold">
            Korrekturanträge ({inbox.corrections.length})
          </h2>
          {inbox.corrections.map((c) => (
            <article
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border-l-[6px] border-l-warning bg-surface p-3"
            >
              <div>
                <p className="font-semibold">
                  {c.userName} · {fmtDate(c.workDate)}
                </p>
                <p>{c.proposal.map((p) => `${KIND_LABEL[p.kind] ?? p.kind} ${p.time} Uhr`).join(', ')}</p>
                {c.comment && <p className="text-sm text-text-muted">„{c.comment}“</p>}
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    void act(
                      () =>
                        apiFetch(`/v1/approvals/correction-requests/${c.id}`, {
                          method: 'POST',
                          body: JSON.stringify({ decision: 'ANGENOMMEN' }),
                        }),
                      'Korrektur übernommen.',
                    )
                  }
                >
                  Übernehmen
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt('Begründung für die Ablehnung:') ?? '';
                    void act(
                      () =>
                        apiFetch(`/v1/approvals/correction-requests/${c.id}`, {
                          method: 'POST',
                          body: JSON.stringify({ decision: 'ABGELEHNT', reason }),
                        }),
                      'Antrag abgelehnt.',
                    );
                  }}
                >
                  Ablehnen
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}

      <section aria-labelledby="zeiten" className="flex flex-col gap-3">
        <h2 id="zeiten" className="text-xl font-semibold">
          Zeiten freigeben
        </h2>
        {inbox && !inbox.days.length && <p className="text-text-muted">Keine offenen Zeiten.</p>}
        {[...byUser.entries()].map(([name, list]) => (
          <div key={name} className="flex flex-col gap-2">
            <h3 className="font-semibold">{name}</h3>
            {list.map((d) => (
              <article
                key={d.workDate}
                data-day={`${d.userId}|${d.workDate}`}
                className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{fmtDate(d.workDate)}</p>
                  <p className="text-sm tabular-nums">
                    Anwesend {fmtMinutes(d.summary.attendanceMinutes)} · Pause{' '}
                    {fmtMinutes(d.summary.breakMinutes)} · Aufträge {fmtMinutes(d.summary.orderMinutes)} ·
                    Fahrt {fmtMinutes(d.summary.travelMinutes)}
                  </p>
                </div>
                <ul className="text-sm">
                  {d.orders.map((o) => (
                    <li key={`${o.orderId}-${o.activity}`}>
                      {o.bcNo} {o.customerName} · {ACTIVITY_LABELS[o.activity]} · {fmtMinutes(o.minutes)}
                    </li>
                  ))}
                </ul>
                {d.needsCorrection && (
                  <p className="font-semibold text-danger">Ausstempeln fehlt – Korrektur nötig</p>
                )}
                {d.running && <p className="text-warning">Buchung läuft noch</p>}
                {d.skewFlag && (
                  <p className="font-semibold text-warning">⚠ Geräteuhr wich ab – Zeiten bitte prüfen</p>
                )}
                {d.summary.warnings.map((w) => (
                  <p key={w.code} className="text-sm text-warning">
                    ⚠ {w.message}
                  </p>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!d.approvable}
                    onClick={() =>
                      void act(
                        () =>
                          apiFetch('/v1/approvals/time-days', {
                            method: 'POST',
                            body: JSON.stringify({ userId: d.userId, workDate: d.workDate }),
                          }),
                        `Zeiten vom ${fmtDate(d.workDate)} freigegeben – Übertragung nach BC läuft.`,
                      )
                    }
                  >
                    Freigeben
                  </Button>
                  <Button variant="secondary" onClick={() => setCorrecting(d)}>
                    Korrigieren
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ))}
      </section>

      {!!inbox?.consumptions.length && (
        <section aria-labelledby="material" className="flex flex-col gap-2">
          <h2 id="material" className="text-xl font-semibold">
            Material & Verbrauchsstoffe ({inbox.consumptions.length})
          </h2>
          {[...new Set(inbox.consumptions.map((c) => c.orderId ?? 'intern'))].map((key) => {
            const list = inbox.consumptions.filter((c) => (c.orderId ?? 'intern') === key);
            const head = list[0]!;
            return (
              <article
                key={key}
                data-consumptions={key}
                className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
              >
                <p className="font-semibold">
                  {head.orderId ? `${head.bcNo} · ${head.customerName}` : 'Interne Entnahmen (Kostenstelle)'}
                </p>
                <ul className="flex flex-col gap-1">
                  {list.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1"
                    >
                      <span>
                        {c.quantity} {c.unit} {c.itemName}{' '}
                        <span className="text-sm text-text-muted">
                          ({c.storage}, {c.userName}
                          {c.costCenter ? `, KST ${c.costCenter}` : ''})
                        </span>
                        {c.stockConflict && (
                          <span className="ml-2 text-sm font-semibold text-danger">Bestandskonflikt</span>
                        )}
                        {!c.meterPlausible && (
                          <span className="ml-2 text-sm font-semibold text-warning">Zähler unplausibel</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="min-h-touch px-2 font-semibold underline"
                        onClick={() => {
                          const reason = window.prompt('Begründung für die Ablehnung:');
                          if (reason)
                            void act(
                              () =>
                                apiFetch(`/v1/approvals/consumptions/${c.id}/reject`, {
                                  method: 'POST',
                                  body: JSON.stringify({ reason }),
                                }),
                              'Entnahme abgelehnt – Bestand zurückgebucht.',
                            );
                        }}
                      >
                        Ablehnen
                      </button>
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() =>
                    void act(
                      () =>
                        apiFetch('/v1/approvals/consumptions', {
                          method: 'POST',
                          body: JSON.stringify({ ids: list.map((c) => c.id) }),
                        }),
                      'Material freigegeben – Übertragung nach BC läuft.',
                    )
                  }
                >
                  Alle {list.length} freigeben
                </Button>
              </article>
            );
          })}
        </section>
      )}

      {!!inbox?.orders.length && (
        <section aria-labelledby="auftraege" className="flex flex-col gap-2">
          <h2 id="auftraege" className="text-xl font-semibold">
            Fertige Aufträge freigeben ({inbox.orders.length})
          </h2>
          {inbox.orders.map((o) => (
            <article
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-3"
            >
              <div>
                <p className="font-semibold">
                  {o.bcNo} · {o.customerName}
                </p>
                <p className="text-sm text-text-muted">{o.description}</p>
                <a href={`/meister/auftrag?id=${o.id}`} className="text-sm font-semibold underline">
                  Bericht und Fotos ansehen
                </a>
              </div>
              <Button
                onClick={() =>
                  void act(
                    () =>
                      apiFetch(`/v1/orders/${o.id}/status`, {
                        method: 'POST',
                        body: JSON.stringify({ status: 'FREIGEGEBEN' }),
                      }),
                    `${o.bcNo} freigegeben – Status wird nach BC übertragen.`,
                  )
                }
              >
                Auftrag freigeben
              </Button>
            </article>
          ))}
        </section>
      )}

      {correcting && (
        <CorrectionDialog
          day={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={async () => {
            setCorrecting(null);
            setMsg({ ok: true, text: 'Korrektur gespeichert (mit Begründung im Audit-Log).' });
            await load();
          }}
        />
      )}
    </div>
  );
}

/** Correction: void wrong events, add missing ones, mandatory reason (PROMPT 4: "immer mit Begründung und Audit-Log"). */
function CorrectionDialog({
  day,
  onClose,
  onSaved,
}: {
  day: InboxDay;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [events, setEvents] = useState<DayEvent[]>([]);
  const [voids, setVoids] = useState<Set<string>>(new Set());
  const [add, setAdd] = useState<Array<{ kind: string; time: string }>>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void apiFetch<DayEvent[]>(`/v1/approvals/day-events?userId=${day.userId}&workDate=${day.workDate}`).then(
      setEvents,
    );
  }, [day]);
  const field = 'min-h-touch rounded-card border border-border bg-surface px-3';
  const submit = async () => {
    try {
      await apiFetch('/v1/approvals/time-corrections', {
        method: 'POST',
        body: JSON.stringify({
          userId: day.userId,
          workDate: day.workDate,
          voidEventIds: [...voids],
          addEvents: add,
          reason,
        }),
      });
      await onSaved();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? ((e.body as { issues?: Array<{ message: string }> })?.issues?.[0]?.message ?? e.message)
          : 'Fehler',
      );
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="corr-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-card bg-surface p-4">
        <h2 id="corr-title" className="text-lg font-semibold">
          Zeiten korrigieren · {day.userName} · {fmtDate(day.workDate)}
        </h2>
        <p className="text-sm text-text-muted">
          Stempelungen werden nie gelöscht, sondern storniert und durch neue ersetzt.
        </p>
        <ul className="flex flex-col gap-1">
          {events.map((e) => (
            <li key={e.id}>
              <label
                className={`flex min-h-touch items-center gap-3 ${e.voided ? 'line-through opacity-60' : ''}`}
              >
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  disabled={e.voided}
                  checked={voids.has(e.id)}
                  onChange={(ev) => {
                    const n = new Set(voids);
                    if (ev.target.checked) n.add(e.id);
                    else n.delete(e.id);
                    setVoids(n);
                  }}
                />
                <span className="tabular-nums">{localTime(new Date(e.deviceTime), 'Europe/Berlin')}</span>
                <span>
                  {KIND_LABEL[e.kind]}
                  {e.activity ? ` · ${ACTIVITY_LABELS[e.activity]}` : ''}
                  {e.createdBy ? ' (Korrektur)' : ''}
                </span>
                <span className="ml-auto text-sm text-text-muted">stornieren</span>
              </label>
            </li>
          ))}
        </ul>
        {add.map((a, i) => (
          <div key={i} className="grid grid-cols-2 gap-2">
            <select
              aria-label="Art"
              className={field}
              value={a.kind}
              onChange={(e) => setAdd(add.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
            >
              {['CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_STOP'].map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              aria-label="Uhrzeit"
              type="time"
              className={field}
              value={a.time}
              onChange={(e) => setAdd(add.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
            />
          </div>
        ))}
        <Button variant="secondary" onClick={() => setAdd([...add, { kind: 'CLOCK_OUT', time: '16:00' }])}>
          Stempelung hinzufügen
        </Button>
        <label className="flex flex-col gap-1">
          Begründung (Pflicht)
          <textarea
            className="rounded-card border border-border bg-surface p-3"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()}>Korrektur speichern</Button>
        </div>
      </div>
    </div>
  );
}
