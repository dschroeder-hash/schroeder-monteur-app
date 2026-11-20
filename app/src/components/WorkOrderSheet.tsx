'use client';

import { ACTIVITY_LABELS, segmentMinutes, type Activity } from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Clock, Package, Tractor } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fmtDay, fmtMinutes, fmtTime } from '@/lib/format';
import { localDb, type LocalOrder } from '@/lib/offline/db';
import { useNow, useSegments, useTimezone } from '@/lib/offline/hooks';

/**
 * The order as a workshop order (Werkstattauftrag): header, machine, working hours per day and activity, parts and
 * material, report. Read from the device (offline). Shown on the order and as the document the customer signs.
 */
export function WorkOrderSheet({
  order,
  showReport = false,
  onUndo,
}: {
  order: LocalOrder;
  showReport?: boolean;
  /** Withdrawals not yet handed to BC can be undone on the order page. */
  onUndo?: (consumptionId: string) => void;
}) {
  const { me } = useAuth();
  const tz = useTimezone();
  const now = useNow(30_000);
  const segments = useSegments(me?.id)
    .filter((s) => s.kind === 'ORDER' && s.orderId === order.id)
    .sort((a, b) => a.start.localeCompare(b.start));
  const consumed =
    useLiveQuery(() => localDb.consumptions.where('orderId').equals(order.id).toArray(), [order.id]) ?? [];
  const requests =
    useLiveQuery(() => localDb.partRequests.where('orderId').equals(order.id).toArray(), [order.id]) ?? [];
  const report = useLiveQuery(() => localDb.workReports.get(order.id), [order.id]);
  const items =
    useLiveQuery(async () => {
      const ids = [...consumed.map((c) => c.itemId), ...requests.map((r) => r.itemId)].filter(
        (x): x is string => !!x,
      );
      return (await localDb.items.bulkGet(ids)).filter((i) => !!i);
    }, [consumed, requests]) ?? [];
  const item = (id: string | null) => items.find((i) => i?.id === id);

  const minutesOf = (s: (typeof segments)[number]) =>
    s.end ? segmentMinutes(s) : (now.getTime() - Date.parse(s.start)) / 60_000;
  const byActivity = new Map<Activity, number>();
  for (const s of segments)
    if (s.activity) byActivity.set(s.activity, (byActivity.get(s.activity) ?? 0) + minutesOf(s));
  const total = segments.reduce((sum, s) => sum + minutesOf(s), 0);
  const parts = consumed.filter((c) => c.state !== 'REJECTED');
  const m = order.items[0]?.machine;

  const th = 'px-3 py-2 text-left text-sm font-semibold text-text-muted';
  const td = 'px-3 py-2 align-top';

  return (
    <article
      aria-label="Werkstattauftrag"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">Werkstattauftrag</p>
          <h2 className="text-xl font-bold">
            {order.bcNo} · {order.customerName}
          </h2>
          {order.address && (
            <p className="text-sm text-text-muted">
              {order.address.street}, {order.address.postCode} {order.address.city}
            </p>
          )}
        </div>
        {m && (
          <p className="flex items-center gap-2 text-sm">
            <Tractor aria-hidden className="h-5 w-5 text-accent" />
            <span>
              <span className="font-semibold">
                {m.brand} {m.model}
              </span>
              <br />
              SN {m.serialNo}
              {m.operatingHours != null && ` · ${m.operatingHours.toLocaleString('de-DE')} Bh.`}
            </span>
          </p>
        )}
      </header>
      {(order.faultDescription || order.description) && (
        <p>
          <span className="font-semibold">Auftrag: </span>
          {order.faultDescription || order.description}
        </p>
      )}

      <section aria-labelledby="wo-hours" className="flex flex-col gap-2">
        <h3 id="wo-hours" className="flex items-center gap-2 font-bold">
          <Clock aria-hidden className="h-5 w-5 text-accent" /> Arbeitsstunden
        </h3>
        {segments.length ? (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[28rem] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className={th}>Datum</th>
                  <th className={th}>Tätigkeit</th>
                  <th className={th}>Von – Bis</th>
                  <th className={`${th} text-right`}>Dauer</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className={td}>{fmtDay(s.workDate)}</td>
                    <td className={td}>{s.activity ? ACTIVITY_LABELS[s.activity] : ''}</td>
                    <td className={`${td} tabular-nums`}>
                      {fmtTime(s.start, tz)} – {s.end ? fmtTime(s.end, tz) : 'läuft'}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{fmtMinutes(minutesOf(s))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold">
                {[...byActivity].map(([a, min]) => (
                  <tr key={a}>
                    <td className={td} colSpan={3}>
                      {ACTIVITY_LABELS[a]}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{fmtMinutes(min)}</td>
                  </tr>
                ))}
                <tr className="bg-surface-muted">
                  <td className={td} colSpan={3}>
                    Gesamt
                  </td>
                  <td className={`${td} text-right tabular-nums`} data-testid="wo-total">
                    {fmtMinutes(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-text-muted">Noch keine Zeit auf diesen Auftrag gebucht.</p>
        )}
        <p className="text-xs text-text-muted">
          Gestempelte Zeiten dieses Geräts; nach BC gehen die gerundeten Stunden je Tag und Tätigkeit.
        </p>
      </section>

      <section aria-labelledby="wo-parts" className="flex flex-col gap-2">
        <h3 id="wo-parts" className="flex items-center gap-2 font-bold">
          <Package aria-hidden className="h-5 w-5 text-accent" /> Ersatzteile und Material
        </h3>
        {parts.length || requests.length ? (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[28rem] border-collapse">
              <thead className="bg-surface-muted">
                <tr>
                  <th className={`${th} text-right`}>Menge</th>
                  <th className={th}>Artikel</th>
                  <th className={th}>Nr.</th>
                  <th className={th}>Stand</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className={`${td} text-right tabular-nums`}>
                      {c.quantity.toLocaleString('de-DE')} {c.unit}
                    </td>
                    <td className={td}>{item(c.itemId)?.name ?? ''}</td>
                    <td className={`${td} tabular-nums`}>{item(c.itemId)?.number ?? ''}</td>
                    <td className={td}>
                      {onUndo && c.state === 'SUBMITTED' ? (
                        <button
                          type="button"
                          className="min-h-touch font-semibold underline"
                          onClick={() => onUndo(c.id)}
                        >
                          Rückgängig
                        </button>
                      ) : (
                        'entnommen'
                      )}
                    </td>
                  </tr>
                ))}
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className={`${td} text-right tabular-nums`}>{r.quantity}</td>
                    <td className={td}>{r.itemId ? item(r.itemId)?.name : r.newItemText}</td>
                    <td className={`${td} tabular-nums`}>{r.itemId ? item(r.itemId)?.number : ''}</td>
                    <td className={td}>{r.state === 'GELIEFERT' ? 'geliefert' : 'bestellt'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-text-muted">Keine Teile gebucht.</p>
        )}
      </section>

      {showReport && (
        <section aria-labelledby="wo-report" className="flex flex-col gap-1">
          <h3 id="wo-report" className="font-bold">
            Arbeitsbericht
          </h3>
          <p className="whitespace-pre-wrap">{report?.body || '–'}</p>
        </section>
      )}
    </article>
  );
}
