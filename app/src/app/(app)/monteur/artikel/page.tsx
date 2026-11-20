'use client';

import { ArrowRightLeft, MapPin, Package, ScanLine, Search, Warehouse } from 'lucide-react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Scanner } from '@/components/Scanner';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { searchLocal, STORAGE_LABEL, type ItemWithStock } from '@/lib/offline/material';

interface Remote {
  id: string;
  number: string;
  name: string;
  unit: string;
  otherLocations: Array<{ locationCode: string; name: string; available: number }>;
  substitutes: Array<{
    number: string;
    name: string;
    relation: 'ERSATZ' | 'NACHFOLGER' | 'VORGAENGER';
    note: string;
  }>;
  stock: Array<{
    storageLocationId: string;
    name: string;
    kind: keyof typeof STORAGE_LABEL;
    available: number;
  }>;
}
const RELATION = { ERSATZ: 'Ersatzartikel', NACHFOLGER: 'Nachfolger', VORGAENGER: 'Vorgänger' } as const;

/**
 * Item lookup without an order (E-71): all items of the own location's catalog (offline), online additionally the
 * stock of other locations and substitute / successor items from BC.
 */
function ItemLookup() {
  const [text, setText] = useState('');
  const [local, setLocal] = useState<ItemWithStock[]>([]);
  const [remote, setRemote] = useState<Remote[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [online, setOnline] = useState(true);
  useEffect(() => setOnline(navigator.onLine), [text]);

  const search = useCallback(async (q: string, code = false) => {
    setLocal(await searchLocal(q));
    setRemote(null);
    if (navigator.onLine)
      apiFetch<Remote[]>(`/v1/items/search?${code ? 'code' : 'q'}=${encodeURIComponent(q)}`)
        .then(setRemote)
        .catch(() => setRemote(null));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => text.trim().length >= 2 && void search(text), 300);
    return () => clearTimeout(t);
  }, [text, search]);

  const numbers = [...new Set([...local.map((i) => i.number), ...(remote ?? []).map((i) => i.number)])];
  const show = (no: string) => {
    setText(no);
    void search(no, true);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-headline text-3xl">Artikel</h1>
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Artikelnummer, Bezeichnung oder EAN</span>
          <Search aria-hidden className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
          <input
            className="min-h-touch w-full rounded-card border border-border bg-surface pl-10 pr-3"
            placeholder="Artikelnummer, Bezeichnung oder EAN"
            value={text}
            inputMode="search"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <Button variant="secondary" onClick={() => setScanning(true)}>
          <ScanLine aria-hidden className="h-5 w-5" /> Scannen
        </Button>
      </div>
      {!online && (
        <p className="text-sm text-text-muted">
          Offline: nur Ihr Standort. Andere Läger und Ersatzartikel mit Verbindung.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {numbers.map((no) => {
          const l = local.find((i) => i.number === no);
          const r = remote?.find((i) => i.number === no);
          const name = l?.name ?? r?.name ?? '';
          const unit = l?.unit ?? r?.unit ?? '';
          const own = l
            ? l.stock.map((s) => ({
                key: s.storage.id,
                label: s.storage.kind === 'LAGER' ? STORAGE_LABEL.LAGER : s.storage.name,
                qty: s.available,
              }))
            : (r?.stock ?? []).map((s) => ({
                key: s.storageLocationId,
                label: s.kind === 'LAGER' ? STORAGE_LABEL.LAGER : s.name,
                qty: s.available,
              }));
          return (
            <li
              key={no}
              data-item={no}
              className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
            >
              <div className="flex items-start gap-3">
                <Package aria-hidden className="mt-1 h-6 w-6 shrink-0 text-accent" />
                <div>
                  <p className="font-semibold tabular-nums text-text-muted">{no}</p>
                  <p className="text-lg font-bold">{name}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <section aria-label={`Bestand ${no} am Standort`}>
                  <h2 className="flex items-center gap-1 text-sm font-semibold uppercase text-text-muted">
                    <Warehouse aria-hidden className="h-4 w-4" /> Ihr Standort
                  </h2>
                  {own.length ? (
                    <ul>
                      {own.map((s) => (
                        <li key={s.key} className="flex justify-between gap-2">
                          <span>{s.label}</span>
                          <span className={`font-semibold tabular-nums ${s.qty > 0 ? '' : 'text-danger'}`}>
                            {s.qty.toLocaleString('de-DE')} {unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-text-muted">kein Bestand</p>
                  )}
                </section>
                {r && (
                  <section aria-label={`Bestand ${no} an anderen Standorten`}>
                    <h2 className="flex items-center gap-1 text-sm font-semibold uppercase text-text-muted">
                      <MapPin aria-hidden className="h-4 w-4" /> Andere Standorte
                    </h2>
                    {r.otherLocations.length ? (
                      <ul>
                        {r.otherLocations.map((o) => (
                          <li key={o.locationCode} className="flex justify-between gap-2">
                            <span>{o.name}</span>
                            <span className="font-semibold tabular-nums">
                              {o.available.toLocaleString('de-DE')} {unit}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-text-muted">nirgends vorrätig</p>
                    )}
                  </section>
                )}
              </div>
              {r && r.substitutes.length > 0 && (
                <section
                  aria-label={`Ersatz- und Nachfolgeartikel zu ${no}`}
                  className="border-t border-border pt-2"
                >
                  <h2 className="flex items-center gap-1 text-sm font-semibold uppercase text-text-muted">
                    <ArrowRightLeft aria-hidden className="h-4 w-4" /> Ersatz- und Nachfolgeartikel
                  </h2>
                  <ul className="flex flex-col">
                    {r.substitutes.map((s) => (
                      <li key={s.number}>
                        <button
                          type="button"
                          className="min-h-touch text-left underline"
                          onClick={() => show(s.number)}
                        >
                          <span className="font-semibold">{RELATION[s.relation]}:</span> {s.number} {s.name}
                          {s.note && <span className="text-text-muted"> ({s.note})</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </li>
          );
        })}
      </ul>
      {text.trim().length >= 2 && numbers.length === 0 && <p className="text-text-muted">Nichts gefunden.</p>}

      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onResult={(code) => {
            setScanning(false);
            show(code);
          }}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ItemLookup />
    </Suspense>
  );
}
