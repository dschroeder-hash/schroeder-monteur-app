import type { AppStatus } from '@schroeder/shared';
import { ChevronRight, MapPin, Tractor, Wrench } from 'lucide-react';
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

/** The Monteur only needs to know whether the work is done (E-66) – no workflow statuses on the card. */
function doneLabel(s: AppStatus): { text: string; tone: string } | null {
  if (s === 'FERTIG_DOKU_OFFEN') return { text: 'Doku offen', tone: 'bg-warning-bg text-warning' };
  if (s === 'FERTIG' || s === 'FREIGEGEBEN' || s === 'ABGERECHNET')
    return { text: 'Abgeschlossen', tone: 'bg-success-bg text-success' };
  return null;
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
  const done = doneLabel(order.appStatus);
  const body = (
    <article className="flex overflow-hidden rounded-card border border-border bg-surface shadow-sm transition-shadow hover:shadow-md">
      <div className="flex w-20 shrink-0 flex-col items-center justify-center gap-0.5 bg-primary px-1 py-3 text-on-primary sm:w-24">
        {a ? (
          <>
            <span className="text-xl font-bold tabular-nums sm:text-2xl">{fmtTime(a.plannedStart, tz)}</span>
            <span className="text-xs font-semibold">Uhr</span>
          </>
        ) : (
          <Wrench aria-hidden className="h-7 w-7" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-muted">
              {order.bcNo} · {order.orderTypeCode}
              {a && <span className="sr-only">{` · ${fmtTime(a.plannedStart, tz)} Uhr`}</span>}
            </p>
            <h3 className="text-lg font-bold leading-snug">{order.customerName}</h3>
          </div>
          {done && (
            <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${done.tone}`}>
              {done.text}
            </span>
          )}
        </div>
        {m && (
          <p className="flex items-center gap-2">
            <Tractor aria-hidden className="h-5 w-5 shrink-0 text-accent" />
            <span>
              <span className="font-semibold">{m.model}</span>
              <span className="text-text-muted"> · SN {m.serialNo}</span>
              {m.operatingHours != null && (
                <span className="text-text-muted"> · {m.operatingHours.toLocaleString('de-DE')} h</span>
              )}
            </span>
          </p>
        )}
        <p className="text-text-muted">{order.faultDescription || order.description}</p>
        {order.address && (
          <p className="flex items-center gap-2 text-sm">
            <MapPin aria-hidden className="h-4 w-4 shrink-0 text-text-muted" />
            {order.address.street}, {order.address.postCode} {order.address.city}
          </p>
        )}
      </div>
      {href !== null && (
        <div className="flex items-center pr-3 text-text-muted" aria-hidden>
          <ChevronRight className="h-6 w-6" />
        </div>
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
