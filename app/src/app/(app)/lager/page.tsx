'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useApi } from '@/lib/useApi';

interface Request {
  id: string;
  bcNo: string;
  customerName: string;
  requestedByName: string;
  quantity: number;
  newItemText: string | null;
  manufacturerPartNo: string | null;
  expectedDelivery: string | null;
  state: 'OFFEN' | 'BESTELLT';
  item: { number: string; name: string; unit: string } | null;
}
interface Warning {
  itemNumber: string;
  name: string;
  unit: string;
  storage: string;
  available: number;
  minStock: number;
}

/** Teiledienst (role Lager, E-12): part requests of the location and stock below minimum. */
export default function StorePage() {
  const { me } = useAuth();
  const loc = me?.grants.find((g) => g.role === 'LAGER' || g.role === 'MEISTER')?.locationId;
  const requests = useApi<Request[]>(loc ? `/v1/parts/requests?locationId=${loc}` : null);
  const warnings = useApi<Warning[]>(loc ? `/v1/stock/warnings?locationId=${loc}` : null);
  const [msg, setMsg] = useState<string | null>(null);
  const setState = async (id: string, state: 'BESTELLT' | 'GELIEFERT' | 'STORNIERT') => {
    try {
      await apiFetch(`/v1/parts/requests/${id}/state`, { method: 'POST', body: JSON.stringify({ state }) });
      setMsg(
        state === 'GELIEFERT' ? 'Als geliefert gemeldet – der Monteur wird benachrichtigt.' : 'Gespeichert.',
      );
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Fehler');
    }
    await requests.reload();
  };
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-headline text-2xl">Teiledienst</h1>
      {msg && <p role="status">{msg}</p>}
      <section aria-labelledby="anf" className="flex flex-col gap-2">
        <h2 id="anf" className="text-xl font-semibold">
          Bestellanforderungen ({requests.data?.length ?? 0})
        </h2>
        {requests.data?.map((r) => (
          <article
            key={r.id}
            className={`flex flex-col gap-2 rounded-card border-l-[6px] bg-surface p-3 ${r.item ? 'border-l-info' : 'border-l-warning'}`}
          >
            <p className="font-semibold">
              {r.quantity} × {r.item ? `${r.item.number} ${r.item.name}` : `Neuer Artikel: ${r.newItemText}`}
              {r.manufacturerPartNo && (
                <span className="font-mono text-sm"> (Hersteller-Nr. {r.manufacturerPartNo})</span>
              )}
            </p>
            <p className="text-sm text-text-muted">
              {r.bcNo} · {r.customerName} · angefordert von {r.requestedByName} · Lieferung{' '}
              {r.expectedDelivery
                ? new Date(`${r.expectedDelivery}T12:00:00Z`).toLocaleDateString('de-DE')
                : '–'}{' '}
              · {r.state === 'OFFEN' ? 'offen' : 'bestellt'}
            </p>
            <div className="flex flex-wrap gap-2">
              {r.state === 'OFFEN' && (
                <Button onClick={() => void setState(r.id, 'BESTELLT')}>Bestellt</Button>
              )}
              <Button variant="secondary" onClick={() => void setState(r.id, 'GELIEFERT')}>
                Geliefert
              </Button>
              <Button variant="ghost" onClick={() => void setState(r.id, 'STORNIERT')}>
                Stornieren
              </Button>
            </div>
          </article>
        ))}
      </section>
      <section aria-labelledby="min" className="flex flex-col gap-2">
        <h2 id="min" className="text-xl font-semibold">
          Unter Mindestbestand ({warnings.data?.length ?? 0})
        </h2>
        <ul>
          {warnings.data?.map((w) => (
            <li
              key={`${w.itemNumber}-${w.storage}`}
              className="flex justify-between border-b border-border py-2"
            >
              <span>
                {w.name} <span className="text-sm text-text-muted">({w.storage})</span>
              </span>
              <span className="font-semibold text-warning tabular-nums">
                {w.available} / min. {w.minStock} {w.unit}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
