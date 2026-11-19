import { DEFAULT_STATUS_DEFINITIONS } from '@schroeder/shared';
import type { OrderSummary } from '@/lib/types';

export function OrderCard({ order }: { order: OrderSummary }) {
  const m = order.machines[0];
  const a = order.assignments[0];
  const time = a
    ? new Date(a.plannedStart).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <article className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-text-muted">
            {order.bcNo} · {order.orderTypeCode}
            {time && ` · ${time} Uhr`}
          </p>
          <h3 className="text-lg font-semibold">{order.customerName}</h3>
        </div>
        <span className="rounded-full bg-surface-muted px-3 py-1 text-sm font-semibold">
          {DEFAULT_STATUS_DEFINITIONS[order.appStatus].label}
        </span>
      </div>
      {m && (
        <p className="mt-1">
          {m.model} <span className="text-text-muted">· SN {m.serialNo}</span>
          {m.operatingHours != null && (
            <span className="text-text-muted"> · {m.operatingHours.toLocaleString('de-DE')} h</span>
          )}
        </p>
      )}
      <p className="mt-1 text-text-muted">{order.faultDescription || order.description}</p>
      {order.address && (
        <p className="mt-1 text-sm">
          {order.address.street}, {order.address.postCode} {order.address.city}
        </p>
      )}
    </article>
  );
}
