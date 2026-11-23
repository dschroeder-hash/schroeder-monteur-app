'use client';

import { CircleCheck, ClipboardPaste, ExternalLink, PanelTop, ScanLine } from 'lucide-react';
import {
  agcoDeeplinkAdapter,
  estimateDelivery,
  extractPartNos,
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
  /** Several part numbers taken over from the catalog at once (drag & drop or pasted list). */
  const [catalogList, setCatalogList] = useState<
    Array<{
      partNo: string;
      state: 'pending' | 'found' | 'missing' | 'offline';
      name?: string;
      done?: boolean;
    }>
  >([]);
  const [dropActive, setDropActive] = useState(false);
  const machine = order?.items[0]?.machine;
  const [catalogTemplate, setCatalogTemplate] = useState<string | undefined>(undefined);
  /** AGCO catalog inside the page (E-74) – Admin can switch it off; the Monteur opens/closes it. */
  const [embedAllowed, setEmbedAllowed] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedTall, setEmbedTall] = useState(true);
  useEffect(() => {
    if (navigator.onLine)
      apiFetch<Array<{ id: string; template: string | null; embed?: boolean }>>('/v1/parts/catalogs')
        .then((c) => {
          const a = c.find((x) => x.id === 'agco');
          setCatalogTemplate(a?.template ?? undefined);
          setEmbedAllowed(a?.embed ?? false);
        })
        .catch(() => undefined);
  }, []);
  const agco = agcoDeeplinkAdapter(catalogTemplate);
  /** Without a search URL the catalog opens on its start page; the number is put on the clipboard (OP-24). */
  const copyForCatalog = (q: string) => {
    if (agco.searchInUrl) return;
    void navigator.clipboard
      ?.writeText(q)
      .then(() => toast(`„${q}“ kopiert – im AGCO-Katalog in die Suche einfügen`))
      .catch(() => toast(`Im AGCO-Katalog nach „${q}“ suchen`));
  };

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
  /** Exact match of one part number: local catalog first, then the BC item master (online). */
  const lookup = async (
    partNo: string,
  ): Promise<{ state: 'found' | 'missing' | 'offline'; name?: string }> => {
    const local = (await searchLocal(partNo)).find(
      (i) => normalizePartNo(i.number) === normalizePartNo(partNo),
    );
    if (local) return { state: 'found', name: local.name };
    if (!navigator.onLine) return { state: 'offline' };
    try {
      const r = await apiFetch<{ items: RemoteItem[] }>(
        `/v1/items/resolve?text=${encodeURIComponent(partNo)}`,
      );
      return r.items[0] ? { state: 'found', name: r.items[0].name } : { state: 'missing' };
    } catch {
      return { state: 'offline' };
    }
  };
  /** Shows one part number in the normal result list (with stock per storage and "add to cart"). */
  const showPart = async (partNo: string) => {
    setText(partNo);
    const hit = await lookup(partNo);
    if (hit.state === 'missing') setRequestFor({ text: partNo });
    else await search(partNo, true);
  };
  /** Text from the catalog – dragged over, pasted or from the clipboard. One number: show it, several: list. */
  const ingest = async (raw: string) => {
    const nos = extractPartNos(raw);
    if (!nos.length) return toast('Keine Teilenummer erkannt');
    setPaste('');
    if (nos.length === 1) {
      setCatalogList([]);
      return showPart(nos[0]!);
    }
    setCatalogList(nos.map((partNo) => ({ partNo, state: 'pending' })));
    for (const partNo of nos) {
      const hit = await lookup(partNo);
      setCatalogList((cur) => cur.map((c) => (c.partNo === partNo ? { ...c, ...hit } : c)));
    }
  };
  const resolvePaste = () => ingest(paste);
  const fromClipboard = async () => {
    try {
      await ingest(await navigator.clipboard.readText());
    } catch {
      toast('Zwischenablage nicht lesbar – Teilenummer bitte ins Feld einfügen');
    }
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
          <ScanLine aria-hidden className="h-5 w-5" />
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
        onDragOver={(e) => {
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropActive(false);
          void ingest(e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text'));
        }}
        data-testid="catalog-drop"
        className={`flex flex-col gap-3 rounded-card border-2 p-3 transition-colors ${
          dropActive ? 'border-dashed border-primary bg-success-bg' : 'border-border bg-surface'
        }`}
      >
        <h2 id="hersteller" className="font-bold">
          Herstellerkatalog (AGCO: Fendt, Valtra, Massey Ferguson)
        </h2>
        <div className="flex flex-wrap gap-2">
          {agco.startUrl && embedAllowed && (
            <Button
              variant={embedOpen ? 'primary' : 'secondary'}
              aria-expanded={embedOpen}
              onClick={() => setEmbedOpen((o) => !o)}
            >
              <PanelTop aria-hidden className="h-5 w-5" />
              {embedOpen ? 'Katalog ausblenden' : 'Katalog hier anzeigen'}
            </Button>
          )}
          {agco.startUrl && (
            <a
              className="inline-flex min-h-touch items-center gap-2 rounded-card bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover"
              href={agco.startUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-catalog="agco-start"
            >
              <ExternalLink aria-hidden className="h-5 w-5" />
              AGCO-Katalog öffnen
            </a>
          )}
          {machine?.serialNo && agco.brands.includes(machine.brand.toUpperCase()) && (
            <a
              className="inline-flex min-h-touch items-center rounded-card border-2 border-border px-4 font-semibold"
              href={agco.buildSearchUrl({ serialNo: machine.serialNo }) ?? '#'}
              onClick={() => copyForCatalog(machine.serialNo)}
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
              onClick={() => copyForCatalog(text)}
              target="_blank"
              rel="noopener noreferrer"
            >
              AGCO: „{text}“ suchen
            </a>
          )}
          <Button variant="secondary" onClick={() => void fromClipboard()}>
            <ClipboardPaste aria-hidden className="h-5 w-5" />
            Teilenummer aus Zwischenablage
          </Button>
        </div>
        {embedOpen && agco.startUrl && (
          <div className="flex flex-col gap-2" data-testid="catalog-embed">
            <iframe
              title="AGCO-Teilekatalog"
              src={agco.startUrl}
              className={`w-full rounded-card border border-border bg-white ${embedTall ? 'h-[65vh]' : 'h-[40vh]'}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
              referrerPolicy="no-referrer"
              allow="clipboard-write"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-muted">
              <span>
                Teilenummer im Katalog markieren und in diesen Kasten ziehen – oder kopieren und „Teilenummer
                aus Zwischenablage“ tippen. Bleibt die Fläche leer oder klappt die Anmeldung nicht, lässt AGCO
                die Anzeige in der App nicht zu: dann „AGCO-Katalog öffnen“.
              </span>
              <Button variant="ghost" onClick={() => setEmbedTall((t) => !t)}>
                {embedTall ? 'Katalog kleiner' : 'Katalog größer'}
              </Button>
            </div>
          </div>
        )}
        <ol className="list-inside list-decimal text-sm text-text-muted">
          <li>
            <strong className="text-text">Nebeneinander auf dem iPad:</strong> „AGCO-Katalog öffnen“ gedrückt
            halten und an den rechten Bildschirmrand ziehen.
          </li>
          <li>
            Im Katalog Teilenummer (oder mehrere Zeilen) markieren und{' '}
            <strong className="text-text">hierher ziehen</strong> – oder kopieren und „Teilenummer aus
            Zwischenablage“ tippen.
          </li>
        </ol>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="paste">
            Teilenummer aus dem Katalog
          </label>
          <input
            id="paste"
            className={`${field} min-w-0 flex-1`}
            placeholder="… oder hier einfügen"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              void ingest(e.clipboardData.getData('text/plain'));
            }}
          />
          <Button variant="secondary" onClick={() => void resolvePaste()}>
            Übernehmen
          </Button>
        </div>
        {catalogList.length > 0 && (
          <div className="flex flex-col gap-1" aria-live="polite">
            <h3 className="font-semibold">Aus dem Katalog ({catalogList.length} Teilenummern)</h3>
            <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
              {catalogList.map((c) => (
                <li key={c.partNo} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-semibold tabular-nums">{c.partNo}</span>
                    <span className="text-text-muted">
                      {' · '}
                      {c.state === 'pending'
                        ? 'wird gesucht …'
                        : c.state === 'found'
                          ? c.name
                          : c.state === 'missing'
                            ? 'nicht im Artikelstamm'
                            : 'offline – später prüfen'}
                    </span>
                  </span>
                  {c.state === 'found' && (
                    <Button
                      variant={c.done ? 'ghost' : 'secondary'}
                      onClick={() => {
                        setCatalogList((cur) =>
                          cur.map((x) => (x.partNo === c.partNo ? { ...x, done: true } : x)),
                        );
                        void showPart(c.partNo);
                      }}
                    >
                      {c.done && <CircleCheck aria-hidden className="h-5 w-5 text-success" />}
                      Auswählen
                    </Button>
                  )}
                  {c.state === 'missing' && (
                    <Button variant="secondary" onClick={() => setRequestFor({ text: c.partNo })}>
                      Beim Lager anfragen
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
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
