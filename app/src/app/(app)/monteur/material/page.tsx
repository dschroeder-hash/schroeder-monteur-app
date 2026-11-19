'use client';

import {
  agcoDeeplinkAdapter,
  estimateDelivery,
  extractPartNo,
  normalizePartNo,
  type Bundesland,
} from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Scanner } from '@/components/Scanner';
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { kvGet, localDb, type CartLine } from '@/lib/offline/db';
import { searchLocal, STORAGE_LABEL, withStock, type ItemWithStock } from '@/lib/offline/material';
import { useSync } from '@/lib/offline/SyncProvider';

interface RemoteItem {
  id: string;
  number: string;
  name: string;
  unit: string;
  otherLocations: Array<{ locationCode: string; name: string; bcLocationCode: string; available: number }>;
}

const field = 'min-h-touch rounded-card border border-border bg-surface px-3';

/** Parts like in a shop (PROMPT 5.5): search, scan, cart per order, take from warehouse/van or request. */
function PartsPage() {
  const orderId = useSearchParams().get('orderId') ?? '';
  const { run } = useSync();
  const order = useLiveQuery(() => localDb.orders.get(orderId), [orderId]);
  const cart = useLiveQuery(() => localDb.cart.where('orderId').equals(orderId).toArray(), [orderId]) ?? [];
  const cartItems =
    useLiveQuery(
      async () =>
        withStock(await localDb.items.bulkGet(cart.map((c) => c.itemId)).then((x) => x.filter((i) => !!i))),
      [cart],
    ) ?? [];
  const [text, setText] = useState('');
  const [results, setResults] = useState<ItemWithStock[]>([]);
  const [remote, setRemote] = useState<Record<string, RemoteItem>>({});
  const [scanning, setScanning] = useState(false);
  const [requestFor, setRequestFor] = useState<{ item?: ItemWithStock; text?: string } | null>(null);
  const [paste, setPaste] = useState('');
  const machine = order?.items[0]?.machine;
  const agco = agcoDeeplinkAdapter();

  const search = useCallback(async (q: string, code = false) => {
    const local = await searchLocal(q);
    setResults(local);
    // Other warehouses are only known online (ARCHITEKTUR 4.2).
    if (navigator.onLine)
      apiFetch<RemoteItem[]>(`/v1/items/search?${code ? 'code' : 'q'}=${encodeURIComponent(q)}`)
        .then((r) => {
          setRemote(Object.fromEntries(r.map((x) => [x.id, x])));
          const known = new Set(local.map((l) => l.id));
          const missing = r.filter((x) => !known.has(x.id));
          if (missing.length)
            setResults((cur) => [
              ...cur,
              ...missing.map((m) => ({
                ...m,
                category: '',
                gtin: '',
                isConsumable: false,
                blocked: false,
                imageUrl: null,
                barcodes: [],
                stock: [],
              })),
            ]);
        })
        .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => text.length >= 2 && void search(text), 300);
    return () => clearTimeout(t);
  }, [text, search]);

  const addToCart = async (item: ItemWithStock, storageLocationId: string) => {
    const existing = cart.find((c) => c.itemId === item.id && c.storageLocationId === storageLocationId);
    if (existing) await localDb.cart.update(existing.id, { quantity: existing.quantity + 1 });
    else
      await localDb.cart.put({
        id: crypto.randomUUID(),
        orderId,
        itemId: item.id,
        storageLocationId,
        quantity: 1,
      });
    toast(`${item.name} im Warenkorb`);
  };
  const setQty = (c: CartLine, q: number) =>
    q <= 0 ? localDb.cart.delete(c.id) : localDb.cart.update(c.id, { quantity: q });
  const takeAll = async () => {
    for (const c of cart)
      await run('ConsumeItem', {
        orderId,
        itemId: c.itemId,
        storageLocationId: c.storageLocationId,
        quantity: c.quantity,
      });
    await localDb.cart.where('orderId').equals(orderId).delete();
    toast('Entnahme gebucht – Freigabe durch den Meister');
  };
  const resolvePaste = async () => {
    const partNo = extractPartNo(paste);
    if (!partNo) return toast('Keine Teilenummer erkannt');
    setText(partNo);
    const local = (await searchLocal(partNo)).filter(
      (i) => normalizePartNo(i.number) === normalizePartNo(partNo),
    );
    if (local.length || !navigator.onLine) return setResults(local.length ? local : []);
    const r = await apiFetch<{ items: RemoteItem[] }>(`/v1/items/resolve?text=${encodeURIComponent(paste)}`);
    if (!r.items.length) setRequestFor({ text: partNo });
    else await search(partNo, true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header>
        <p className="text-sm text-text-muted">
          {order ? `${order.bcNo} · ${order.customerName}` : 'Auftrag'}
        </p>
        <h1 className="font-headline text-2xl">Teile</h1>
      </header>

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="part-search">
          Teilenummer, Bezeichnung oder EAN
        </label>
        <input
          id="part-search"
          className={`${field} min-w-0 flex-1`}
          placeholder="Teilenummer, Bezeichnung oder EAN"
          value={text}
          onChange={(e) => setText(e.target.value)}
          inputMode="search"
        />
        <Button variant="secondary" onClick={() => setScanning(true)} aria-label="Barcode scannen">
          Scannen
        </Button>
      </div>

      <ul className="flex flex-col gap-2" aria-label="Suchergebnisse">
        {results.map((i) => {
          const own = i.stock.filter((s) => s.storage.kind !== 'TANK');
          const others = remote[i.id]?.otherLocations ?? [];
          const none = own.every((s) => s.available <= 0);
          return (
            <li key={i.id} className="rounded-card border border-border bg-surface p-3" data-item={i.number}>
              <p className="font-mono text-sm text-text-muted">{i.number}</p>
              <p className="font-semibold">{i.name}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {own.map((s) => (
                  <Button
                    key={s.storage.id}
                    variant="secondary"
                    disabled={s.available <= 0}
                    onClick={() => void addToCart(i, s.storage.id)}
                  >
                    {s.storage.kind === 'LAGER' ? STORAGE_LABEL.LAGER : s.storage.name}: {s.available}{' '}
                    {i.unit}
                  </Button>
                ))}
                {none && <Button onClick={() => setRequestFor({ item: i })}>Fehlt – bestellen</Button>}
              </div>
              {others.length > 0 && (
                <p className="mt-2 text-sm text-text-muted">
                  Andere Läger: {others.map((o) => `${o.name} ${o.available}`).join(' · ')}
                </p>
              )}
            </li>
          );
        })}
        {text.length >= 2 && results.length === 0 && (
          <li className="flex flex-col gap-2 rounded-card border border-dashed border-border p-3">
            <p>Nichts gefunden{navigator.onLine ? '' : ' (offline nur im Standortkatalog)'}.</p>
            <Button variant="secondary" onClick={() => setRequestFor({ text })}>
              Teil nicht im Stamm – Anfrage ans Lager
            </Button>
          </li>
        )}
      </ul>

      <section
        aria-labelledby="hersteller"
        className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
      >
        <h2 id="hersteller" className="font-semibold">
          Herstellerkatalog
        </h2>
        <p className="text-sm text-text-muted">
          Öffnet den AGCO-Teilekatalog in einem neuen Tab. Die gefundene Teilenummer hier einfügen.
        </p>
        <div className="flex flex-wrap gap-2">
          {machine?.serialNo && agco.brands.includes(machine.brand.toUpperCase()) && (
            <a
              className="inline-flex min-h-touch items-center rounded-card border-2 border-border px-4 font-semibold"
              href={agco.buildSearchUrl({ serialNo: machine.serialNo }) ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
            >
              AGCO: Seriennr. {machine.serialNo}
            </a>
          )}
          {text && (
            <a
              className="inline-flex min-h-touch items-center rounded-card border-2 border-border px-4 font-semibold"
              href={agco.buildSearchUrl({ partNo: text }) ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
            >
              AGCO: „{text}“ suchen
            </a>
          )}
        </div>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="paste">
            Teilenummer aus dem Katalog
          </label>
          <input
            id="paste"
            className={`${field} min-w-0 flex-1`}
            placeholder="Teilenummer aus Katalog einfügen"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <Button variant="secondary" onClick={() => void resolvePaste()}>
            Übernehmen
          </Button>
        </div>
      </section>

      {cart.length > 0 && (
        <section
          aria-labelledby="warenkorb"
          className="flex flex-col gap-2 rounded-card border-2 border-primary bg-surface p-3"
        >
          <h2 id="warenkorb" className="font-semibold">
            Warenkorb ({cart.length})
          </h2>
          {cart.map((c) => {
            const it = cartItems.find((x) => x.id === c.itemId);
            const st = it?.stock.find((s) => s.storage.id === c.storageLocationId);
            return (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <span>
                  {it?.name}{' '}
                  <span className="text-sm text-text-muted">
                    ({st ? (st.storage.kind === 'LAGER' ? STORAGE_LABEL.LAGER : st.storage.name) : ''})
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    aria-label="weniger"
                    onClick={() => void setQty(c, c.quantity - 1)}
                  >
                    −
                  </Button>
                  <span className="w-10 text-center font-semibold tabular-nums">{c.quantity}</span>
                  <Button
                    variant="secondary"
                    aria-label="mehr"
                    onClick={() => void setQty(c, c.quantity + 1)}
                  >
                    +
                  </Button>
                </span>
              </div>
            );
          })}
          <Button size="lg" onClick={() => void takeAll()}>
            Entnehmen und auf Auftrag buchen
          </Button>
        </section>
      )}

      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onResult={(code) => {
            setScanning(false);
            setText(code);
            void search(code, true);
          }}
        />
      )}
      {requestFor && (
        <RequestDialog
          orderId={orderId}
          item={requestFor.item}
          text={requestFor.text}
          onClose={() => setRequestFor(null)}
        />
      )}
    </div>
  );
}

function RequestDialog({
  orderId,
  item,
  text,
  onClose,
}: {
  orderId: string;
  item?: ItemWithStock;
  text?: string;
  onClose: () => void;
}) {
  const { run } = useSync();
  const [qty, setQty] = useState(1);
  const [desc, setDesc] = useState(text ?? '');
  const [wait, setWait] = useState(true);
  const loc = useLiveQuery(() => kvGet<{ timezone: string; bundesland?: string }>(localDb, 'location'), []);
  const est = estimateDelivery(
    new Date(),
    loc?.timezone ?? 'Europe/Berlin',
    (loc?.bundesland ?? 'NI') as Bundesland,
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="req-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <form
        className="flex w-full max-w-md flex-col gap-3 rounded-card bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            'RequestPart',
            item
              ? { orderId, itemId: item.id, quantity: qty, setWaitingForParts: wait }
              : {
                  orderId,
                  newItemText: desc,
                  manufacturerPartNo: text ?? null,
                  quantity: qty,
                  setWaitingForParts: wait,
                },
          ).then(() => {
            toast('Bestellanforderung ans Lager gesendet');
            onClose();
          });
        }}
      >
        <h2 id="req-title" className="text-lg font-semibold">
          {item ? `${item.number} bestellen` : 'Neuer Artikel – Anfrage ans Lager'}
        </h2>
        <p
          className={`rounded-card p-3 font-semibold ${est.afterCutoff ? 'bg-warning-bg text-warning' : 'bg-info-bg text-info'}`}
        >
          Bestellschluss 17:00 Uhr → Lieferung {est.label}
        </p>
        {!item && (
          <label className="flex flex-col gap-1">
            Beschreibung
            <input className={field} value={desc} onChange={(e) => setDesc(e.target.value)} required />
          </label>
        )}
        <label className="flex flex-col gap-1">
          Menge
          <input
            type="number"
            min={1}
            className={field}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            required
          />
        </label>
        <label className="flex min-h-touch items-center gap-3">
          <input
            type="checkbox"
            className="h-6 w-6"
            checked={wait}
            onChange={(e) => setWait(e.target.checked)}
          />
          Auftrag auf „Wartet auf Teile“ setzen
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit">Anfordern</Button>
        </div>
      </form>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-text-muted">Wird geladen …</p>}>
      <PartsPage />
    </Suspense>
  );
}
