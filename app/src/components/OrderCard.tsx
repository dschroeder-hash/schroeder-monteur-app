import { DEFAULT_STATUS_DEFINITIONS, type AppStatus } from '@schroeder/shared';
import Link from 'next/link';
import { fmtTime } from '@/lib/format';

export interface OrderCardData {
  id: string;
  bcNo: string;
  orderTypeCode: string;
  appStatus: AppStatus;
  customerName: string;
  description: string;
  faultDescription: string;
  address: { street: string; postCode: string; city: string } | null;
  items?: Array<{ machine: { model: string; serialNo: string; operatingHours: number | null } | null }>;
  machines?: Array<{ model: string; serialNo: string; operatingHours: number | null } | null>;
  assignments: Array<{ plannedStart: string }>;
}

export function OrderCard({
  order,
  tz = 'Europe/Berlin',
  href,
}: {
  order: OrderCardData;
  tz?: string;
  href?: string | null;
}) {
  const m = order.items?.[0]?.machine ?? order.machines?.[0] ?? null;
  const a = order.assignments[0];
  const body = (
    <article className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-text-muted">
            {order.bcNo} · {order.orderTypeCode}
            {a && ` · ${fmtTime(a.plannedStart, tz)} Uhr`}
          </p>
          <h3 className="text-lg font-semibold">{order.customerName}</h3>
        </div>
        <span className="shrink-0 rounded-full bg-surface-muted px-3 py-1 text-sm font-semibold">
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
  if (href === null) return body;
  const link = href ?? `/monteur/auftrag?id=${order.id}`;
  return (
    <Link href={link} className="block rounded-card">
      {body}
    </Link>
  );
}
