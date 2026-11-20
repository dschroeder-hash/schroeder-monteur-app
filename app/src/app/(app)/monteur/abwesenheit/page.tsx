'use client';

import {
  ABSENCE_STATE_LABELS,
  absenceDays,
  addDays,
  HALF_DAY_LABELS,
  localDate,
  vacationBalance,
  type Bundesland,
  type HalfDay,
} from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { SickReportDialog } from '@/components/SickReportDialog';
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fmtDay as fmtDate } from '@/lib/format';
import { kvGet, kvSet, localDb, type LocalAbsence } from '@/lib/offline/db';
import { useTimezone } from '@/lib/offline/hooks';
import { useSync } from '@/lib/offline/SyncProvider';

const field = 'min-h-touch rounded-card border border-border bg-surface px-3';
type TeamAbsence = {
  userId: string;
  userName: string;
  fromDate: string;
  toDate: string | null;
  halfDay: HalfDay;
};

const period = (a: { fromDate: string; toDate: string | null; halfDay?: HalfDay }) =>
  `${a.toDate && a.toDate !== a.fromDate ? `${fmtDate(a.fromDate)} – ${fmtDate(a.toDate)}` : a.toDate ? fmtDate(a.fromDate) : `ab ${fmtDate(a.fromDate)}`}${a.halfDay && a.halfDay !== 'NONE' ? ` (${HALF_DAY_LABELS[a.halfDay]})` : ''}`;

/** Own absences, remaining vacation and the team calendar (PROMPT 5.9/5.10). Works offline except the team view. */
export default function AbsencePage() {
  const { me } = useAuth();
  const tz = useTimezone();
  const { run } = useSync();
  const today = localDate(new Date(), tz);
  const year = Number(today.slice(0, 4));
  const absences = useLiveQuery(() => localDb.absences.orderBy('fromDate').reverse().toArray(), []) ?? [];
  const balances = useLiveQuery(
    () =>
      kvGet<Array<{ year: number; entitlementDays: number; carryOverDays: number }>>(
        localDb,
        'vacationBalances',
      ),
    [],
  );
  const loc = useLiveQuery(() => kvGet<{ bundesland?: Bundesland }>(localDb, 'location'), []);
  const land: Bundesland = loc?.bundesland ?? 'NI';
  const [sick, setSick] = useState(false);
  const [team, setTeam] = useState<{ list: TeamAbsence[]; offline: boolean } | null>(null);

  useEffect(() => {
    const from = today;
    const to = addDays(today, 60);
    apiFetch<TeamAbsence[]>(`/v1/absences/team?from=${from}&to=${to}`)
      .then(async (list) => {
        setTeam({ list, offline: false });
        await kvSet(localDb, 'teamAbsences', list);
      })
      .catch(async () =>
        setTeam({ list: (await kvGet<TeamAbsence[]>(localDb, 'teamAbsences')) ?? [], offline: true }),
      );
  }, [today]);

  const activeSick = absences.find(
    (a) => a.type === 'KRANK' && a.state === 'REPORTED' && (!a.toDate || a.toDate >= today),
  );
  const balance = vacationBalance(year, balances?.find((b) => b.year === year) ?? null, absences, land);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-headline text-2xl">Abwesenheit</h1>

      {me?.features['absence.sick'] && (
        <section
          aria-labelledby="krank"
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        >
          <h2 id="krank" className="text-xl font-semibold">
            Krankmeldung
          </h2>
          {activeSick ? (
            <SickStatus
              absence={activeSick}
              onEnd={(toDate) =>
                void run('UpdateSickEnd', { absenceId: activeSick.id, toDate }).then(() =>
                  toast('Gespeichert – Ihr Meister wird informiert.'),
                )
              }
            />
          ) : (
            <Button size="lg" variant="danger" onClick={() => setSick(true)}>
              Krank melden
            </Button>
          )}
        </section>
      )}

      {me?.features['absence.vacation'] && (
        <>
          <section aria-labelledby="rest" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <h2 id="rest" className="sr-only">
              Resturlaub {year}
            </h2>
            <Stat label={`Anspruch ${year}`} value={balance.entitlement + balance.carryOver} />
            <Stat label="Genehmigt" value={balance.taken} />
            <Stat label="Beantragt" value={balance.requested} />
            <Stat label="Resturlaub" value={balance.remaining} strong />
          </section>
          {!balances?.some((b) => b.year === year) && (
            <p className="text-sm text-text-muted">
              Ihr Urlaubsanspruch ist noch nicht hinterlegt – bitte bei der Personalabteilung melden.
            </p>
          )}
          <VacationForm
            land={land}
            today={today}
            onSubmit={async (v) => {
              await run('RequestVacation', v);
              toast('Urlaubsantrag gespeichert – Ihr Meister entscheidet.');
            }}
          />
        </>
      )}

      <section aria-labelledby="meine" className="flex flex-col gap-2">
        <h2 id="meine" className="text-xl font-semibold">
          Meine Abwesenheiten
        </h2>
        {absences.length === 0 && <p className="text-text-muted">Keine Abwesenheiten.</p>}
        <ul className="flex flex-col gap-2">
          {absences.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-surface p-3"
            >
              <div>
                <p className="font-semibold">
                  {a.type === 'KRANK' ? 'Krank' : 'Urlaub'} · {period(a)}
                </p>
                <p className="text-sm text-text-muted">
                  {ABSENCE_STATE_LABELS[a.state]}
                  {a.type === 'URLAUB' && ` · ${absenceDays(a, land)} Arbeitstage`}
                  {a.pending && ' · wird übertragen'}
                  {a.decisionReason && ` · ${a.decisionReason}`}
                </p>
              </div>
              {a.type === 'URLAUB' &&
                (a.state === 'REQUESTED' || a.state === 'APPROVED') &&
                a.fromDate > today && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void run('WithdrawVacation', { absenceId: a.id }).then(() =>
                        toast(
                          a.state === 'REQUESTED'
                            ? 'Antrag zurückgezogen.'
                            : 'Stornoantrag gestellt – Ihr Meister entscheidet.',
                        ),
                      )
                    }
                  >
                    {a.state === 'REQUESTED' ? 'Zurückziehen' : 'Storno beantragen'}
                  </Button>
                )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="team" className="flex flex-col gap-2">
        <h2 id="team" className="text-xl font-semibold">
          Abwesend im Team (nächste 60 Tage)
        </h2>
        {team?.offline && <p className="text-sm text-text-muted">Offline – Stand der letzten Verbindung.</p>}
        {team && team.list.filter((t) => t.userId !== me?.id).length === 0 && (
          <p className="text-text-muted">Niemand abwesend.</p>
        )}
        <ul className="flex flex-col gap-1">
          {team?.list
            .filter((t) => t.userId !== me?.id)
            .map((t, i) => (
              <li
                key={`${t.userId}-${t.fromDate}-${i}`}
                className="flex justify-between gap-2 border-b border-border py-2"
              >
                <span className="font-semibold">{t.userName.replace(/\s*\(.*\)$/, '')}</span>
                <span className="text-text-muted">abwesend · {period(t)}</span>
              </li>
            ))}
        </ul>
      </section>

      {sick && <SickReportDialog onClose={() => setSick(false)} />}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div
      className={`rounded-card border p-3 ${strong ? 'border-accent bg-surface' : 'border-border bg-surface'}`}
    >
      <p className="text-sm text-text-muted">{label}</p>
      <p className={`text-2xl font-semibold ${value < 0 ? 'text-danger' : ''}`}>
        {value.toLocaleString('de-DE')}
      </p>
    </div>
  );
}

function SickStatus({ absence, onEnd }: { absence: LocalAbsence; onEnd: (toDate: string) => void }) {
  const [to, setTo] = useState(absence.toDate ?? '');
  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold">
        Krank gemeldet {period(absence)}
        {absence.pending && <span className="text-sm font-normal text-text-muted"> · wird übertragen</span>}
      </p>
      <label className="flex flex-col gap-1 font-semibold">
        Voraussichtlich bis
        <input
          type="date"
          className={field}
          value={to}
          min={absence.fromDate}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      <Button variant="secondary" disabled={!to || to === absence.toDate} onClick={() => onEnd(to)}>
        Ende speichern
      </Button>
    </div>
  );
}

function VacationForm({
  land,
  today,
  onSubmit,
}: {
  land: Bundesland;
  today: string;
  onSubmit: (v: {
    fromDate: string;
    toDate: string;
    halfDay: HalfDay;
    comment: string | null;
  }) => Promise<void>;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [half, setHalf] = useState<HalfDay>('NONE');
  const [comment, setComment] = useState('');
  const single = !!from && (!to || to === from);
  const end = to || from;
  const days =
    from && end >= from
      ? absenceDays({ fromDate: from, toDate: end, halfDay: single ? half : 'NONE' }, land)
      : 0;
  const valid = !!from && end >= from && days > 0;
  return (
    <form
      aria-labelledby="antrag"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void onSubmit({
          fromDate: from,
          toDate: end,
          halfDay: single ? half : 'NONE',
          comment: comment.trim() || null,
        }).then(() => {
          setFrom('');
          setTo('');
          setHalf('NONE');
          setComment('');
        });
      }}
    >
      <h2 id="antrag" className="text-xl font-semibold">
        Urlaub beantragen
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 font-semibold">
          Von
          <input
            type="date"
            className={field}
            value={from}
            min={today}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 font-semibold">
          Bis
          <input
            type="date"
            className={field}
            value={to}
            min={from || today}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {single && (
        <fieldset className="flex flex-wrap gap-3">
          <legend className="mb-1 font-semibold">Umfang</legend>
          {(['NONE', 'AM', 'PM'] as const).map((h) => (
            <label key={h} className="flex min-h-touch items-center gap-2">
              <input
                type="radio"
                name="half"
                checked={half === h}
                onChange={() => setHalf(h)}
                className="h-5 w-5"
              />
              {HALF_DAY_LABELS[h]}
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex flex-col gap-1 font-semibold">
        Bemerkung (optional)
        <input
          className={field}
          value={comment}
          maxLength={500}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      {from && (
        <p className="text-text-muted">
          {days.toLocaleString('de-DE')} Arbeitstage (ohne Wochenenden und Feiertage)
        </p>
      )}
      <Button type="submit" disabled={!valid}>
        Urlaub beantragen
      </Button>
    </form>
  );
}
