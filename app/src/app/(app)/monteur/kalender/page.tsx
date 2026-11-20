'use client';

import { addDays, localDate } from '@schroeder/shared';
import { useState } from 'react';
import { OrderCard } from '@/components/OrderCard';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fmtDate, fmtTime } from '@/lib/format';
import { useMyOrders, useTimezone, type MyOrder } from '@/lib/offline/hooks';
import Link from 'next/link';

type View = 'tag' | 'woche' | 'liste';

/** Own assignments only (PROMPT 5.2): day, week and list view from the offline cache. */
export default function CalendarPage() {
  const { me } = useAuth();
  const tz = useTimezone();
  const orders = useMyOrders(me?.id);
  const today = localDate(new Date(), tz);
  const [view, setView] = useState<View>('tag');
  const [day, setDay] = useState(today);

  const slots = orders.flatMap((o) =>
    o.assignments.map((a) => ({ order: o, a, date: localDate(new Date(a.plannedStart), tz) })),
  );
  const on = (d: string) =>
    slots.filter((s) => s.date === d).sort((x, y) => x.a.plannedStart.localeCompare(y.a.plannedStart));
  const monday = addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

  const item = (s: { order: MyOrder; a: { plannedStart: string; plannedEnd: string } }) => (
    <Link
      key={`${s.order.id}-${s.a.plannedStart}`}
      href={`/monteur/auftrag?id=${s.order.id}`}
      className="block rounded-card border border-border border-l-[6px] border-l-accent bg-surface p-3"
    >
      <p className="text-sm font-semibold tabular-nums">
        {fmtTime(s.a.plannedStart, tz)}–{fmtTime(s.a.plannedEnd, tz)}
      </p>
      <p className="font-semibold">{s.order.customerName}</p>
      <p className="text-sm text-text-muted">
        {s.order.bcNo} · {s.order.items[0]?.machine?.model ?? s.order.description}
      </p>
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-headline text-2xl">Kalender</h1>
      <div role="tablist" aria-label="Ansicht" className="grid grid-cols-3 gap-2">
        {(['tag', 'woche', 'liste'] as View[]).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`min-h-touch rounded-card border-2 font-semibold ${view === v ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface'}`}
          >
            {v === 'tag' ? 'Tag' : v === 'woche' ? 'Woche' : 'Liste'}
          </button>
        ))}
      </div>

      {view !== 'liste' && (
        <div className="flex items-center justify-between gap-2">
          <button
            className="min-h-touch min-w-touch rounded-card border border-border px-3 font-semibold"
            onClick={() => setDay(addDays(day, view === 'tag' ? -1 : -7))}
            aria-label="Zurück"
          >
            ←
          </button>
          <button className="min-h-touch font-semibold" onClick={() => setDay(today)}>
            {view === 'tag' ? fmtDate(day) : `KW ab ${fmtDate(monday)}`}{' '}
            {day === today && view === 'tag' ? '(heute)' : ''}
          </button>
          <button
            className="min-h-touch min-w-touch rounded-card border border-border px-3 font-semibold"
            onClick={() => setDay(addDays(day, view === 'tag' ? 1 : 7))}
            aria-label="Weiter"
          >
            →
          </button>
        </div>
      )}

      {view === 'tag' && (
        <div className="flex flex-col gap-2">
          {on(day).length ? on(day).map(item) : <p className="text-text-muted">Keine Einsätze geplant.</p>}
        </div>
      )}

      {view === 'woche' && (
        <div className="grid gap-3 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => (
            <section key={d} aria-label={fmtDate(d)} className="flex flex-col gap-2">
              <h2 className={`text-sm font-semibold ${d === today ? 'text-accent' : 'text-text-muted'}`}>
                {fmtDate(d)}
              </h2>
              {on(d).map(item)}
            </section>
          ))}
        </div>
      )}

      {view === 'liste' && (
        <div className="flex flex-col gap-3">
          {[...new Set(slots.filter((s) => s.date >= today).map((s) => s.date))].sort().map((d) => (
            <section key={d} className="flex flex-col gap-2">
              <h2 className="font-semibold">{fmtDate(d)}</h2>
              {on(d).map((s) => (
                <OrderCard
                  key={`${s.order.id}-${s.a.plannedStart}`}
                  order={{ ...s.order, assignments: [s.a] }}
                  tz={tz}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
