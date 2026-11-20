'use client';

import { RefreshFromBc } from '@/components/RefreshFromBc';
import { DEFAULT_STATUS_DEFINITIONS, REQUIRED_FIELD_DEFS, type AppStatus } from '@schroeder/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PHOTO_CATEGORIES } from '@/components/OrderPhotos';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';

interface Order {
  id: string;
  bcNo: string;
  customerName: string;
  description: string;
  faultDescription: string;
  appStatus: AppStatus;
  items: Array<{ machine: { model: string; serialNo: string } | null }>;
}
interface Report {
  body: string;
  requiredFields: Record<string, string | number | null>;
  complete: boolean;
  authorName: string | null;
}
interface Photo {
  id: string;
  category: keyof typeof PHOTO_CATEGORIES;
  url: string;
  capturedAt: string | null;
}

/** Meister review of an order before approval: report, photos, chat (PROMPT 5.3/5.6/5.7). */
function MeisterOrder() {
  const id = useSearchParams().get('id') ?? '';
  const order = useApi<Order>(`/v1/orders/${id}`);
  const report = useApi<Report | null>(`/v1/orders/${id}/report`);
  const photos = useApi<Photo[]>(`/v1/orders/${id}/photos`);
  const [msg, setMsg] = useState<string | null>(null);
  const approve = async () => {
    try {
      await apiFetch(`/v1/orders/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'FREIGEGEBEN' }),
      });
      setMsg('Freigegeben – Bericht und Status werden nach BC übertragen.');
      await order.reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Fehler');
    }
  };
  const o = order.data;
  if (!o) return <p className="text-text-muted">{order.error ?? 'Wird geladen …'}</p>;
  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-sm text-text-muted">
          {o.bcNo} · {o.items[0]?.machine?.model} · SN {o.items[0]?.machine?.serialNo}
        </p>
        <h1 className="font-headline text-2xl">{o.customerName}</h1>
        <p className="mt-1 inline-block rounded-full bg-surface-muted px-3 py-1 text-sm font-semibold">
          {DEFAULT_STATUS_DEFINITIONS[o.appStatus].label}
        </p>
        <RefreshFromBc orderId={o.id} onRequested={() => void order.reload()} />
      </header>
      {msg && <p role="status">{msg}</p>}
      <section aria-labelledby="bericht" className="rounded-card border border-border bg-surface p-4">
        <h2 id="bericht" className="mb-2 font-semibold">
          Arbeitsbericht{' '}
          {report.data?.authorName && (
            <span className="font-normal text-text-muted">von {report.data.authorName}</span>
          )}
        </h2>
        {report.data ? (
          <>
            <p className="whitespace-pre-wrap">{report.data.body}</p>
            <ul className="mt-2 text-sm">
              {Object.entries(report.data.requiredFields).map(([k, v]) => (
                <li key={k}>
                  {REQUIRED_FIELD_DEFS[k]?.label ?? k}: <strong>{v ?? '–'}</strong>{' '}
                  {REQUIRED_FIELD_DEFS[k]?.unit}
                </li>
              ))}
            </ul>
            {!report.data.complete && (
              <p className="mt-2 font-semibold text-warning">Dokumentation unvollständig</p>
            )}
          </>
        ) : (
          <p className="text-text-muted">Noch kein Bericht.</p>
        )}
      </section>
      <section aria-labelledby="fotos">
        <h2 id="fotos" className="mb-2 font-semibold">
          Fotos ({photos.data?.length ?? 0})
        </h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.data?.map((p) => (
            <li key={p.id}>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={p.url}
                  alt={PHOTO_CATEGORIES[p.category]}
                  className="h-32 w-full rounded-card object-cover"
                />
              </a>
              <span className="text-xs">{PHOTO_CATEGORIES[p.category]}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/meister/chat?orderId=${id}`}
          className="inline-flex min-h-touch items-center rounded-card border-2 border-border bg-surface px-4 font-semibold"
        >
          Chat öffnen
        </Link>
        {o.appStatus === 'FERTIG' && <Button onClick={() => void approve()}>Auftrag freigeben</Button>}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-text-muted">Wird geladen …</p>}>
      <MeisterOrder />
    </Suspense>
  );
}
