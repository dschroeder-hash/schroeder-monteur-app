'use client';

import { HALF_DAY_LABELS, type AbsenceState, type AbsenceType, type HalfDay } from '@schroeder/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { fmtDay as fmtDate } from '@/lib/format';

export interface InboxAbsence {
  id: string;
  type: AbsenceType;
  state: AbsenceState;
  fromDate: string;
  toDate: string | null;
  halfDay: HalfDay;
  comment: string | null;
  userName: string;
  days: number;
  balance: { remaining: number; requested: number; entitlement: number; carryOver: number } | null;
  overlapping: Array<{ userName: string; fromDate: string; toDate: string | null }>;
  affectedAssignments: number;
}

export const absencePeriod = (a: { fromDate: string; toDate: string | null; halfDay?: HalfDay }) =>
  `${a.toDate && a.toDate !== a.fromDate ? `${fmtDate(a.fromDate)} – ${fmtDate(a.toDate)}` : a.toDate ? fmtDate(a.fromDate) : `ab ${fmtDate(a.fromDate)}, Ende offen`}${a.halfDay && a.halfDay !== 'NONE' ? ` (${HALF_DAY_LABELS[a.halfDay]})` : ''}`;

const short = (n: string) => n.replace(/\s*\(.*\)$/, '');

/** Sick reports to acknowledge and vacation (cancel) requests to decide (PROMPT 5.9/5.10). */
export function AbsenceInbox({
  items,
  act,
}: {
  items: InboxAbsence[];
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const decide = (a: InboxAbsence, decision: 'APPROVE' | 'REJECT', why = '') =>
    act(
      () =>
        apiFetch(`/v1/absences/${a.id}/decision`, {
          method: 'POST',
          body: JSON.stringify({ decision, reason: why }),
        }),
      a.state === 'CANCEL_REQUESTED'
        ? decision === 'APPROVE'
          ? 'Urlaub storniert – der Eintrag in BC wird entfernt.'
          : 'Stornoantrag abgelehnt – der Urlaub bleibt bestehen.'
        : decision === 'APPROVE'
          ? 'Urlaub genehmigt – Übertragung nach BC läuft.'
          : 'Urlaub abgelehnt.',
    );

  return (
    <section aria-labelledby="abwesenheiten" className="flex flex-col gap-2">
      <h2 id="abwesenheiten" className="text-xl font-semibold">
        Abwesenheiten ({items.length})
      </h2>
      {items.map((a) => (
        <article
          key={a.id}
          data-absence={a.id}
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
        >
          <p className="font-semibold">
            {short(a.userName)} ·{' '}
            {a.type === 'KRANK'
              ? 'Krankmeldung'
              : a.state === 'CANCEL_REQUESTED'
                ? 'Stornoantrag Urlaub'
                : 'Urlaubsantrag'}
          </p>
          <p>
            {absencePeriod(a)} · {a.days.toLocaleString('de-DE')} Arbeitstage
          </p>
          {a.comment && <p className="text-sm text-text-muted">Bemerkung: {a.comment}</p>}
          {a.balance && a.state === 'REQUESTED' && (
            <p
              className={`text-sm ${a.balance.remaining < 0 ? 'font-semibold text-danger' : 'text-text-muted'}`}
            >
              Resturlaub nach Genehmigung: {a.balance.remaining.toLocaleString('de-DE')} Tage
            </p>
          )}
          {a.overlapping.length > 0 && (
            <p className="text-sm text-warning">
              Zeitgleich abwesend:{' '}
              {a.overlapping.map((o) => `${short(o.userName)} (${absencePeriod(o)})`).join(', ')}
            </p>
          )}
          {a.affectedAssignments > 0 && (
            <p className="text-sm font-semibold text-danger">
              {a.affectedAssignments} {a.affectedAssignments === 1 ? 'Einplanung' : 'Einplanungen'} im
              Zeitraum –{' '}
              <a href="/meister/plantafel" className="underline">
                auf der Plantafel neu einplanen
              </a>
            </p>
          )}
          {a.type === 'KRANK' ? (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  void act(
                    () => apiFetch(`/v1/absences/${a.id}/acknowledge`, { method: 'POST' }),
                    a.toDate
                      ? 'Krankmeldung bestätigt – Übertragung nach BC läuft.'
                      : 'Krankmeldung bestätigt. Sobald das Ende feststeht, wird sie nach BC übertragen.',
                  )
                }
              >
                Zur Kenntnis genommen
              </Button>
            </div>
          ) : rejecting === a.id ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void decide(a, 'REJECT', reason).then(() => {
                  setRejecting(null);
                  setReason('');
                });
              }}
            >
              <label className="flex flex-col gap-1 font-semibold">
                Begründung (Pflicht)
                <input
                  className="min-h-touch rounded-card border border-border bg-surface px-3"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  minLength={3}
                  required
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger" disabled={reason.trim().length < 3}>
                  Ablehnung senden
                </Button>
                <Button type="button" variant="secondary" onClick={() => setRejecting(null)}>
                  Abbrechen
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void decide(a, 'APPROVE')}>
                {a.state === 'CANCEL_REQUESTED' ? 'Storno genehmigen' : 'Genehmigen'}
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(a.id)}>
                Ablehnen
              </Button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
