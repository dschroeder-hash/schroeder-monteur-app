'use client';

import {
  ACTIVITIES,
  ACTIVITY_SHORT_LABELS,
  canTransition,
  DEFAULT_STATUS_DEFINITIONS,
  segmentMinutes,
  type Activity,
  type AppStatus,
} from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { OrderPhotos } from '@/components/OrderPhotos';
import { Suspense } from 'react';

const CONSUMPTION_STATE = {
  OPEN: 'offen',
  SUBMITTED: 'wartet auf Freigabe',
  APPROVED: 'freigegeben',
  TRANSFERRED: 'in BC',
  REJECTED: 'storniert',
} as const;
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fmtMinutes, fmtTime, navLinks, telLink } from '@/lib/format';
import { localDb } from '@/lib/offline/db';
import { useSegments, useStampState, useTimezone } from '@/lib/offline/hooks';
import { useSync } from '@/lib/offline/SyncProvider';

const MONTEUR_STATUSES: AppStatus[] = [
  'UNTERWEGS',
  'IN_ARBEIT',
  'WARTET_TEILE',
  'WARTET_KUNDE',
  'FERTIG_DOKU_OFFEN',
  'FERTIG',
];

/** Order detail (query parameter instead of a dynamic route so the page is precached and opens offline). */
function OrderDetail() {
  const id = useSearchParams().get('id') ?? '';
  const { me } = useAuth();
  const { run } = useSync();
  const tz = useTimezone();
  const order = useLiveQuery(() => localDb.orders.get(id), [id]);
  const history =
    useLiveQuery(() => localDb.statusEvents.where('orderId').equals(id).reverse().sortBy('at'), [id]) ?? [];
  const st = useStampState(me?.id);
  const report = useLiveQuery(() => localDb.workReports.get(id), [id]);
  const unread =
    useLiveQuery(async () => {
      const last = (await localDb.kv.get(`chatRead:${id}`))?.value as number | undefined;
      return localDb.chatMessages
        .where('orderId')
        .equals(id)
        .filter((m) => !m.isSystem && m.authorId !== me?.id && (m.serverSeq ?? 0) > (last ?? 0))
        .count();
    }, [id, me?.id]) ?? 0;
  const consumed = useLiveQuery(() => localDb.consumptions.where('orderId').equals(id).toArray(), [id]) ?? [];
  const requests = useLiveQuery(() => localDb.partRequests.where('orderId').equals(id).toArray(), [id]) ?? [];
  const itemNames =
    useLiveQuery(async () => {
      const ids = [
        ...consumed.map((c) => c.itemId),
        ...requests.map((r) => r.itemId).filter((x): x is string => !!x),
      ];
      const items = await localDb.items.bulkGet(ids);
      return new Map(items.filter((x) => !!x).map((x) => [x!.id, x!.name]));
    }, [consumed, requests]) ?? new Map<string, string>();
  const segments = useSegments(me?.id).filter((s) => s.kind === 'ORDER' && s.orderId === id);

  if (order === undefined)
    return <p className="text-text-muted">Auftrag nicht auf diesem Gerät vorhanden.</p>;
  const machine = order.items[0]?.machine;
  const nav = navLinks(order.address);
  const phone = order.contactMobile || order.contactPhone;
  const runningHere = st.job?.kind === 'ORDER' && st.job.orderId === id ? st.job.activity : null;
  const total = segments.reduce((s, x) => s + segmentMinutes(x), 0);

  const start = async (activity: Activity) => {
    if (!st.clockedIn) toast('„Kommen“ wurde automatisch gestempelt');
    await run('StampJobStart', { orderId: id, activity });
  };
  const setStatus = (status: AppStatus) => void run('SetOrderStatus', { orderId: id, status });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-sm text-text-muted">
          {order.bcNo} · {order.orderTypeCode} · Priorität{' '}
          {order.priority === 'High' ? 'hoch' : order.priority === 'Low' ? 'niedrig' : 'normal'}
        </p>
        <h1 className="font-headline text-2xl">{order.customerName}</h1>
        <p className="mt-1 inline-block rounded-full bg-surface-muted px-3 py-1 text-sm font-semibold">
          {DEFAULT_STATUS_DEFINITIONS[order.appStatus].label}
        </p>
      </header>

      {me?.features.stamping && (
        <section aria-label="Zeit buchen" className="grid grid-cols-3 gap-2">
          {ACTIVITIES.map((a) => (
            <Button
              key={a}
              size="lg"
              variant={runningHere === a ? 'primary' : 'secondary'}
              aria-pressed={runningHere === a}
              onClick={() => runningHere !== a && void start(a)}
            >
              {ACTIVITY_SHORT_LABELS[a]}
            </Button>
          ))}
          <p className="col-span-3 text-sm text-text-muted">
            Gebucht auf diesen Auftrag: {fmtMinutes(total)}
          </p>
        </section>
      )}

      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">Maschine</h2>
        {machine ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-text-muted">Marke</dt>
            <dd>{machine.brand}</dd>
            <dt className="text-text-muted">Modell</dt>
            <dd>{machine.model}</dd>
            <dt className="text-text-muted">Seriennr.</dt>
            <dd className="font-mono">{machine.serialNo}</dd>
            <dt className="text-text-muted">Betriebsstd.</dt>
            <dd>
              {machine.operatingHours != null
                ? `${machine.operatingHours.toLocaleString('de-DE')} h`
                : 'unbekannt'}
            </dd>
          </dl>
        ) : (
          <p className="text-text-muted">Keine Maschine hinterlegt.</p>
        )}
        <h2 className="mb-1 mt-4 font-semibold">Fehlerbeschreibung</h2>
        <p>{order.faultDescription || order.description}</p>
      </section>

      <section className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
        <h2 className="font-semibold">Einsatzort & Kontakt</h2>
        {order.address && (
          <p>
            {order.address.street}, {order.address.postCode} {order.address.city}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {nav && (
            <>
              <a
                className="inline-flex min-h-touch items-center rounded-card border-2 border-border px-4 font-semibold"
                href={nav.google}
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Maps
              </a>
              <a
                className="inline-flex min-h-touch items-center rounded-card border-2 border-border px-4 font-semibold"
                href={nav.apple}
                target="_blank"
                rel="noopener noreferrer"
              >
                Apple Karten
              </a>
            </>
          )}
          {phone && (
            <a
              className="inline-flex min-h-touch items-center rounded-card bg-primary px-4 font-semibold text-on-primary"
              href={telLink(phone)}
            >
              {order.contactName || 'Kontakt'} anrufen
            </a>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Status ändern</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MONTEUR_STATUSES.filter((s) => canTransition(order.appStatus, s, 'MONTEUR')).map((s) => (
            <Button key={s} variant="secondary" onClick={() => setStatus(s)}>
              {DEFAULT_STATUS_DEFINITIONS[s].label}
            </Button>
          ))}
        </div>
      </section>

      <section aria-label="Dokumentation und Kommunikation" className="grid grid-cols-2 gap-2">
        <Link
          href={`/monteur/bericht?orderId=${id}`}
          className={`inline-flex min-h-touch flex-col items-center justify-center rounded-card border-2 px-3 py-2 text-center font-semibold ${report?.complete ? 'border-border bg-surface' : 'border-warning bg-warning-bg text-warning'}`}
        >
          Arbeitsbericht
          <span className="text-xs font-normal">
            {report
              ? report.complete
                ? 'vollständig'
                : report.pending
                  ? 'gespeichert'
                  : 'unvollständig'
              : 'noch leer'}
          </span>
        </Link>
        {me?.features.chat && (
          <Link
            href={`/monteur/chat?orderId=${id}`}
            className="inline-flex min-h-touch flex-col items-center justify-center rounded-card border-2 border-border bg-surface px-3 py-2 font-semibold"
          >
            Chat
            <span className="text-xs font-normal">{unread ? `${unread} neu` : 'mit dem Meister'}</span>
          </Link>
        )}
      </section>

      {me?.features.photos && <OrderPhotos orderId={id} />}

      {(me?.features.materials || me?.features.consumables) && (
        <section aria-labelledby="material" className="flex flex-col gap-2">
          <h2 id="material" className="font-semibold">
            Material
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {me?.features.materials && (
              <Link
                href={`/monteur/material?orderId=${id}`}
                className="inline-flex min-h-touch items-center justify-center rounded-card border-2 border-border bg-surface px-4 font-semibold"
              >
                Teile
              </Link>
            )}
            {me?.features.consumables && (
              <Link
                href={`/monteur/verbrauch?orderId=${id}`}
                className="inline-flex min-h-touch items-center justify-center rounded-card border-2 border-border bg-surface px-4 font-semibold"
              >
                Öl & Diesel
              </Link>
            )}
          </div>
          <ul className="flex flex-col gap-1">
            {consumed.map((c) => (
              <li
                key={c.id}
                className="flex min-h-touch items-center justify-between gap-2 border-b border-border"
              >
                <span className={c.state === 'REJECTED' ? 'line-through opacity-60' : ''}>
                  {c.quantity} {c.unit} {itemNames.get(c.itemId) ?? ''}{' '}
                  <span className="text-sm text-text-muted">({CONSUMPTION_STATE[c.state]})</span>
                </span>
                {c.state === 'SUBMITTED' && (
                  <button
                    type="button"
                    className="min-h-touch px-2 font-semibold underline"
                    onClick={() => void run('RemoveConsumption', { consumptionId: c.id })}
                  >
                    Rückgängig
                  </button>
                )}
              </li>
            ))}
            {requests.map((r) => (
              <li key={r.id} className="min-h-touch border-b border-border py-2">
                Bestellt: {r.quantity} × {r.itemId ? itemNames.get(r.itemId) : r.newItemText}{' '}
                <span className="text-sm text-text-muted">
                  (
                  {r.state === 'GELIEFERT'
                    ? 'geliefert'
                    : `Lieferung ${r.expectedDelivery ? new Date(`${r.expectedDelivery}T12:00:00Z`).toLocaleDateString('de-DE') : 'offen'}`}
                  )
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Verlauf</h2>
          <ol className="flex flex-col gap-1 text-sm">
            {history.map((h) => (
              <li key={h.id}>
                {new Date(h.at).toLocaleDateString('de-DE')} {fmtTime(h.at, tz)} ·{' '}
                {DEFAULT_STATUS_DEFINITIONS[h.toStatus].label}
                <span className="text-text-muted">
                  {' '}
                  (
                  {h.source === 'STEMPELUNG'
                    ? 'automatisch'
                    : h.source === 'BC'
                      ? 'aus BC'
                      : h.source.toLowerCase()}
                  )
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<p className="text-text-muted">Wird geladen …</p>}>
      <OrderDetail />
    </Suspense>
  );
}
