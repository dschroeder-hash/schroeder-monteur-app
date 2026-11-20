'use client';

import { DEFAULT_STATUS_DEFINITIONS, localDate, type AppStatus } from '@schroeder/shared';
import { useState } from 'react';
import { OrderCard } from '@/components/OrderCard';
import { SickReportDialog } from '@/components/SickReportDialog';
import { Button } from '@/components/ui/Button';
import { Tile } from '@/components/ui/Tile';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fmtMinutes } from '@/lib/format';
import { useDaySummary, useMyOrders, useTimezone } from '@/lib/offline/hooks';

const DASHBOARD_STATUSES: AppStatus[] = [
  'EINGEPLANT',
  'UNTERWEGS',
  'IN_ARBEIT',
  'WARTET_TEILE',
  'WARTET_KUNDE',
  'FERTIG_DOKU_OFFEN',
];

/** Monteur dashboard – own orders only, read from the local (offline) cache. */
export default function MonteurDashboard() {
  const { me } = useAuth();
  const tz = useTimezone();
  const orders = useMyOrders(me?.id);
  const today = localDate(new Date(), tz);
  const day = useDaySummary(me?.id);
  const due = orders
    .filter((o) => o.assignments.some((a) => localDate(new Date(a.plannedStart), tz) === today))
    .sort((a, b) =>
      (a.assignments[0]?.plannedStart ?? '').localeCompare(b.assignments[0]?.plannedStart ?? ''),
    );
  const count = (s: AppStatus) => orders.filter((o) => o.appStatus === s).length;
  const [sick, setSick] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-headline text-2xl">Meine Aufträge</h1>
        {me?.features['absence.sick'] && (
          <Button variant="secondary" onClick={() => setSick(true)}>
            Krank melden
          </Button>
        )}
      </div>
      {sick && <SickReportDialog onClose={() => setSick(false)} />}
      <section aria-label="Status" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {DASHBOARD_STATUSES.map((s) => (
          <Tile
            key={s}
            label={DEFAULT_STATUS_DEFINITIONS[s].label}
            value={count(s)}
            tone={s === 'WARTET_TEILE' ? 'warning' : 'default'}
          />
        ))}
        <Tile
          label="Offene Dokumentationen"
          value={count('FERTIG_DOKU_OFFEN')}
          tone={count('FERTIG_DOKU_OFFEN') ? 'warning' : 'default'}
        />
        <Tile label="Ungelesene Nachrichten" value={0} />
        {me?.features['productivity.self'] && (
          <Tile label="Meine Produktivität" value="→" href="/monteur/produktivitaet" />
        )}
        {me?.features.stamping && (
          <Tile
            label="Arbeitszeit heute"
            value={fmtMinutes(day.workMinutes)}
            href="/monteur/zeiten"
            tone={day.warnings.length ? 'warning' : 'default'}
          />
        )}
      </section>
      <section aria-labelledby="heute" className="flex flex-col gap-3">
        <h2 id="heute" className="text-xl font-semibold">
          Heute fällig ({due.length})
        </h2>
        {due.map((o) => (
          <OrderCard key={o.id} order={o} tz={tz} />
        ))}
        {due.length === 0 && <p className="text-text-muted">Heute sind Ihnen keine Aufträge zugewiesen.</p>}
      </section>
    </div>
  );
}
