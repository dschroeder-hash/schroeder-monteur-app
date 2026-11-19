'use client';

import { DEFAULT_STATUS_DEFINITIONS, type AppStatus } from '@schroeder/shared';
import { OrderCard } from '@/components/OrderCard';
import { Tile } from '@/components/ui/Tile';
import { useApi } from '@/lib/useApi';
import type { OrderSummary } from '@/lib/types';

const DASHBOARD_STATUSES: AppStatus[] = [
  'EINGEPLANT',
  'IN_ARBEIT',
  'WARTET_TEILE',
  'WARTET_KUNDE',
  'FERTIG_DOKU_OFFEN',
];

/** Monteur dashboard – own orders only (filtered server-side). Stamping bar follows in phase 2. */
export default function MonteurDashboard() {
  const { data, error, loading } = useApi<OrderSummary[]>('/v1/orders?view=mine');
  const orders = data ?? [];
  const today = new Date().toDateString();
  const startToday = (o: OrderSummary) =>
    o.assignments
      .map((a) => new Date(a.plannedStart))
      .find((d) => d.toDateString() === today)
      ?.getTime() ?? Infinity;
  const dueToday = orders
    .filter((o) => startToday(o) !== Infinity)
    .sort((a, b) => startToday(a) - startToday(b));
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-headline text-2xl">Meine Aufträge</h1>
      {error && (
        <p role="alert" className="rounded-card bg-danger-bg p-3 text-danger">
          {error}
        </p>
      )}
      <section aria-label="Status" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {DASHBOARD_STATUSES.map((s) => (
          <Tile
            key={s}
            label={DEFAULT_STATUS_DEFINITIONS[s].label}
            value={orders.filter((o) => o.appStatus === s).length}
            tone={s === 'WARTET_TEILE' ? 'warning' : 'default'}
          />
        ))}
      </section>
      <section aria-labelledby="heute" className="flex flex-col gap-3">
        <h2 id="heute" className="text-xl font-semibold">
          Heute fällig ({dueToday.length})
        </h2>
        {loading && <p className="text-text-muted">Wird geladen …</p>}
        {dueToday.map((o) => (
          <OrderCard key={o.id} order={o} />
        ))}
        {!loading && dueToday.length === 0 && (
          <p className="text-text-muted">Heute sind Ihnen keine Aufträge zugewiesen.</p>
        )}
      </section>
    </div>
  );
}
