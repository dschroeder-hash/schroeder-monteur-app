'use client';

import { DEFAULT_STATUS_DEFINITIONS, type AppStatus } from '@schroeder/shared';
import { OrderCard } from '@/components/OrderCard';
import { Tile } from '@/components/ui/Tile';
import { useApi } from '@/lib/useApi';
import { useMeisterLocations } from '@/lib/meister';
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
  const loc = useMeisterLocations()[0]?.id;
  const inbox = useApi<{
    days: Array<{ approvable: boolean; needsCorrection: boolean }>;
    corrections: unknown[];
    orders: unknown[];
    consumptions: unknown[];
  }>(loc ? `/v1/approvals/inbox?locationId=${loc}` : null).data;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-headline text-2xl">Standort-Übersicht</h1>
      {error && (
        <p role="alert" className="rounded-card bg-danger-bg p-3 text-danger">
          {error}
        </p>
      )}
      <section aria-label="Freigabe-Inbox" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Zeiten zur Freigabe"
          value={inbox?.days.filter((d) => d.approvable).length ?? '–'}
          href="/meister/freigaben"
        />
        <Tile
          label="Korrektur nötig"
          value={inbox ? inbox.days.filter((d) => d.needsCorrection).length + inbox.corrections.length : '–'}
          href="/meister/freigaben"
          tone={inbox && inbox.corrections.length ? 'warning' : 'default'}
        />
        <Tile label="Aufträge zur Freigabe" value={inbox?.orders.length ?? '–'} href="/meister/freigaben" />
        <Tile
          label="Material zur Freigabe"
          value={inbox?.consumptions.length ?? '–'}
          href="/meister/freigaben"
        />
      </section>
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
              <OrderCard key={o.id} order={o} href={null} />
            ))}
        </div>
      </section>
    </div>
  );
}
