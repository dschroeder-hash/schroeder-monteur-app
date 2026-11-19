'use client';

import { DEFAULT_STATUS_DEFINITIONS, type AppStatus } from '@schroeder/shared';
import { OrderCard } from '@/components/OrderCard';
import { Tile } from '@/components/ui/Tile';
import { useApi } from '@/lib/useApi';
import type { OrderSummary } from '@/lib/types';

const STATUSES: AppStatus[] = [
  'NEU',
  'EINGEPLANT',
  'IN_ARBEIT',
  'WARTET_TEILE',
  'WARTET_KUNDE',
  'FERTIG_DOKU_OFFEN',
  'FERTIG',
];

/** Meister dashboard – all orders of his location(s). Planning board and approval inbox follow in phase 3. */
export default function MeisterDashboard() {
  const { data, error, loading } = useApi<OrderSummary[]>('/v1/orders?view=location');
  const orders = data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-headline text-2xl">Standort-Übersicht</h1>
      {error && (
        <p role="alert" className="rounded-card bg-danger-bg p-3 text-danger">
          {error}
        </p>
      )}
      <section aria-label="Status" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {STATUSES.map((s) => (
          <Tile
            key={s}
            label={DEFAULT_STATUS_DEFINITIONS[s].label}
            value={orders.filter((o) => o.appStatus === s).length}
          />
        ))}
      </section>
      <section aria-labelledby="neu" className="flex flex-col gap-3">
        <h2 id="neu" className="text-xl font-semibold">
          Nicht eingeplant
        </h2>
        {loading && <p className="text-text-muted">Wird geladen …</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {orders
            .filter((o) => o.appStatus === 'NEU')
            .slice(0, 20)
            .map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
        </div>
      </section>
    </div>
  );
}
