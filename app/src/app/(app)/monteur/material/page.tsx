'use client';

import {
  ArrowLeft,
  CircleCheck,
  ClipboardPaste,
  ExternalLink,
  Maximize2,
  ScanLine,
  ShoppingCart,
  X,
} from 'lucide-react';
import {
  agcoDeeplinkAdapter,
  estimateDelivery,
  extractPartNos,
  normalizePartNo,
  type Bundesland,
} from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BackLink } from '@/components/BackLink';
import { MagicTractor } from '@/components/MagicTractor';
import { TractorMagic } from '@/components/TractorMagic';
import { Scanner } from '@/components/Scanner';
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/Button';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthProvider';
import { config } from '@/lib/config';
import { canCaptureTab, captureTab, shrinkImageFile } from '@/lib/cart-capture';
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

/** "AGCO (Fendt, …)" → "AGCO-Katalog"; a label that already says Katalog stays. */
const catalogName = (label: string) => {
  const short = label.split(' (')[0]!;
  return /katalog/i.test(short) ? short : `${short}-Katalog`;
};

/** A manufacturer catalog tile (E-80); `handBack`: the catalog returns its cart to the app. */
interface CatalogTile {
  id: string;
  label: string;
  brands: string[];
  mode: 'iframe' | 'popup';
  handBack: boolean;
  url: string | null;
}

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
      /** Quantity from the manufacturer cart (E-76). */
      quantity?: number;
    }>
  >([]);
  const [dropActive, setDropActive] = useState(false);
  const machine = order?.items[0]?.machine;
  const [catalogTemplate, setCatalogTemplate] = useState<string | undefined>(undefined);
  const [catalogs, setCatalogs] = useState<CatalogTile[]>([]);
  /** Frame catalogs inside the page (E-74) – Admin can switch it off (then own window). */
  const [embedAllowed, setEmbedAllowed] = useState(false);
  /** Catalog shown large inside the page: its address and name; null = closed. */
  const [embed, setEmbed] = useState<{ src: string; label: string } | null>(null);
  const embedOpen = !!embed;
  const setEmbedOpen = (open: boolean) => !open && setEmbed(null);
  /** Results panel under the large catalog: opens when a part number comes over, closable. */
  const [embedPanel, setEmbedPanel] = useState(false);
  useEffect(() => {
    if (!embedOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setEmbedOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedOpen]);
  useEffect(() => {
    if (navigator.onLine)
      apiFetch<{ catalogs: CatalogTile[]; agcoTemplate: string | null; embed: boolean }>('/v1/parts/catalogs')
        .then((r) => {
          setCatalogs(r.catalogs);
          setCatalogTemplate(r.agcoTemplate ?? undefined);
          setEmbedAllowed(r.embed);
        })
        .catch(() => undefined);
  }, []);
  const agco = agcoDeeplinkAdapter(catalogTemplate);
  const agcoHandBack = catalogs.some((c) => c.id === 'agco' && c.handBack);
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
    setEmbedPanel(true);
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
  /** "Warenkorb übertragen" (E-76): picture of the manufacturer cart → AI → lines with quantities. */
  const { me } = useAuth();
  const cartAi = !!me?.features['parts.cartAi'];
  const cartFile = useRef<HTMLInputElement>(null);
  const [cartBusy, setCartBusy] = useState(false);
  const readCart = async (img: Blob) => {
    setCartBusy(true);
    try {
      const r = await apiFetch<{
        lines: Array<{
          partNo: string;
          quantity: number;
          name: string | null;
          item: { id: string; name: string } | null;
        }>;
      }>('/v1/parts/cart-from-image', { method: 'POST', body: img, headers: { 'content-type': img.type } });
      if (!r.lines.length) return toast('Im Bild wurde kein Warenkorb erkannt');
      setCatalogList(
        r.lines.map((l) => ({
          partNo: l.partNo,
          quantity: l.quantity,
          state: l.item ? 'found' : 'missing',
          name: l.item?.name ?? l.name ?? undefined,
        })),
      );
      setEmbedPanel(true);
      toast(`${r.lines.length} Positionen aus dem Warenkorb gelesen – bitte prüfen`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Warenkorb nicht übertragen – bitte erneut versuchen');
    } finally {
      setCartBusy(false);
    }
  };
  const takeCartRef = useRef<(l: Array<{ partNo: string; quantity: number }>) => Promise<void>>(
    async () => undefined,
  );
  /** Cart handed back by a catalog (E-80): resolved against the item master, with quantity – the tractor flies. */
  const takeCatalogCart = async (lines: Array<{ partNo: string; quantity: number }>) => {
    setCartBusy(true);
    setCatalogList(lines.map((l) => ({ partNo: l.partNo, quantity: l.quantity, state: 'pending' })));
    setEmbedPanel(true);
    for (const l of lines) {
      const hit = await lookup(l.partNo);
      setCatalogList((cur) => cur.map((c) => (c.partNo === l.partNo ? { ...c, ...hit } : c)));
    }
    setCartBusy(false);
    toast(`${lines.length} Positionen aus dem Herstellerkatalog übernommen – bitte prüfen`);
  };
  takeCartRef.current = takeCatalogCart;
  /** Picks up carts the catalogs handed back for this order (E-80) and merges them into one list. */
  const pickUp = useCallback(async () => {
    if (!orderId || !navigator.onLine || document.visibilityState !== 'visible') return false;
    try {
      const { carts } = await apiFetch<{
        carts: Array<{ lines: Array<{ partNo: string; quantity: number }> }>;
      }>(`/v1/parts/shop-cart/inbox?orderId=${encodeURIComponent(orderId)}`);
      const lines = carts.flatMap((c) => c.lines);
      if (!lines.length) return false;
      await takeCartRef.current(lines);
      return true;
    } catch {
      return false;
    }
  }, [orderId]);
  /** Opens a catalog: with hand-back via a session (return address for this order), large in the page or as window. */
  const openCatalog = async (c: CatalogTile) => {
    if (!navigator.onLine) return toast('Der Herstellerkatalog braucht eine Verbindung');
    const inPage = c.mode === 'iframe' && embedAllowed;
    // Open the window right away (still inside the tap), otherwise the browser blocks it as a popup.
    const win = inPage ? null : window.open('', `katalog-${c.id}`);
    try {
      const r = c.handBack
        ? await apiFetch<{ url: string }>('/v1/parts/catalog-sessions', {
            method: 'POST',
            body: JSON.stringify({ catalogId: c.id, orderId: orderId || null }),
          })
        : { url: c.url ?? '' };
      // A path (test catalog in demo/tests) lives on the API's address.
      const url = new URL(r.url, config.apiUrl || window.location.origin).toString();
      if (inPage) setEmbed({ src: url, label: c.label });
      else if (win) win.location.href = url;
      else window.location.href = url;
    } catch {
      win?.close();
      toast('Katalog konnte nicht geöffnet werden – bitte erneut versuchen');
    }
  };
  // "Warenkorb übergeben" in the catalog: its answer page tells the app at once; otherwise the app looks when it
  // is shown again and every few seconds.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type !== 'werkstatt-catalog-cart') return;
      setEmbed(null);
      void pickUp();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pickUp]);
  /** "Warenkorb übertragen" (only with AI enabled, E-76): a picture of a cart without hand-back. */
  const transferCart = async () => {
    if (await pickUp()) return;
    if (!navigator.onLine) return toast('Für die Warenkorb-Übernahme wird eine Verbindung benötigt');
    if (canCaptureTab()) {
      const img = await captureTab();
      if (img) return readCart(img);
    }
    toast('Bildschirmfoto vom Warenkorb auswählen (vorher am iPad: Ein/Aus-Taste + Lauter-Taste)');
    cartFile.current?.click();
  };
  useEffect(() => {
    if (!orderId) return;
    void pickUp();
    const onShow = () => void pickUp();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    const t = setInterval(onShow, 5000);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
      clearInterval(t);
    };
  }, [orderId, pickUp]);
  /** Puts every recognised line into the order's cart – from the main warehouse if it has enough, else any storage. */
  const addAllToCart = async () => {
    let added = 0;
    const short: string[] = [];
    for (const c of catalogList) {
      if (c.state !== 'found' || c.done) continue;
      const qty = c.quantity ?? 1;
      const it = (await searchLocal(c.partNo)).find(
        (i) => normalizePartNo(i.number) === normalizePartNo(c.partNo),
      );
      const st = it?.stock
        .filter((x) => x.storage.kind !== 'TANK' && x.available >= qty)
        .sort((a, b) => Number(b.storage.kind === 'LAGER') - Number(a.storage.kind === 'LAGER'))[0];
      if (!it || !st) {
        short.push(c.partNo);
        continue;
      }
      const existing = cart.find((x) => x.itemId === it.id && x.storageLocationId === st.storage.id);
      if (existing) await localDb.cart.update(existing.id, { quantity: existing.quantity + qty });
      else
        await localDb.cart.put({
          id: crypto.randomUUID(),
          orderId,
          itemId: it.id,
          storageLocationId: st.storage.id,
          quantity: qty,
        });
      setCatalogList((cur) => cur.map((x) => (x.partNo === c.partNo ? { ...x, done: true } : x)));
      added++;
    }
    toast(
      `${added} ${added === 1 ? 'Position' : 'Positionen'} im Warenkorb` +
        (short.length ? ` – nicht genug Bestand: ${short.join(', ')}` : ''),
    );
  };
  // Picture + AI only as stop-gap for catalogs without hand-back (E-76); with hand-back it is not needed.
  const cartButton = cartAi && !catalogs.some((c) => c.handBack) && (
    <Button variant="secondary" onClick={() => void transferCart()} disabled={cartBusy} aria-busy={cartBusy}>
      <MagicTractor busy={cartBusy} />
      {cartBusy ? 'Warenkorb wird gelesen …' : 'Warenkorb übertragen'}
    </Button>
  );
  const fromClipboard = async () => {
    try {
      await ingest(await navigator.clipboard.readText());
    } catch {
      toast('Zwischenablage nicht lesbar – Teilenummer bitte ins Feld einfügen');
    }
  };

  const resultList = (
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
                  {s.storage.kind === 'LAGER' ? STORAGE_LABEL.LAGER : s.storage.name}: {s.available} {i.unit}
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
  );
  const catalogListView = catalogList.length > 0 && (
    <div className="flex flex-col gap-1" aria-live="polite">
      <h3 className="font-semibold">Aus dem Katalog ({catalogList.length} Teilenummern)</h3>
      {catalogList.some((c) => c.quantity && c.state === 'found' && !c.done) && (
        <Button className="self-start" onClick={() => void addAllToCart()}>
          <ShoppingCart aria-hidden className="h-5 w-5" />
          Alle in den Warenkorb
        </Button>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
        {catalogList.map((c) => (
          <li key={c.partNo} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0">
              {c.quantity && <span className="font-semibold tabular-nums">{c.quantity} × </span>}
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
                  setCatalogList((cur) => cur.map((x) => (x.partNo === c.partNo ? { ...x, done: true } : x)));
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
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <BackLink orderId={orderId} />
      <header>
        <p className="text-sm text-text-muted">
          {order ? `${order.bcNo} · ${order.customerName}` : 'Auftrag'}
        </p>
        <h1 className="font-headline text-2xl">Teile</h1>
      </header>

      {!embedOpen && (
        <>
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

          {resultList}

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
              Herstellerkataloge
            </h2>
            <div className="flex flex-wrap gap-2">
              {catalogs.map((c) => (
                <Button
                  key={c.id}
                  variant={c.brands.includes(machine?.brand.toUpperCase() ?? '') ? 'primary' : 'secondary'}
                  onClick={() => void openCatalog(c)}
                  data-catalog={c.id}
                >
                  {c.mode === 'iframe' && embedAllowed ? (
                    <Maximize2 aria-hidden className="h-5 w-5" />
                  ) : (
                    <ExternalLink aria-hidden className="h-5 w-5" />
                  )}
                  {catalogName(c.label)}
                </Button>
              ))}
              {!agcoHandBack && machine?.serialNo && agco.brands.includes(machine.brand.toUpperCase()) && (
                <a
                  className="inline-flex min-h-touch items-center rounded-card border-2 border-border px-4 font-semibold"
                  href={agco.buildSearchUrl({ serialNo: machine.serialNo }) ?? '#'}
                  onClick={() => copyForCatalog(machine.serialNo)}
                  target="_blank"
                  rel="noopener"
                >
                  AGCO: Seriennr. {machine.serialNo}
                </a>
              )}
              {!agcoHandBack && text && (
                <a
                  className="inline-flex min-h-touch items-center rounded-card border-2 border-border px-4 font-semibold"
                  href={agco.buildSearchUrl({ partNo: text }) ?? '#'}
                  onClick={() => copyForCatalog(text)}
                  target="_blank"
                  rel="noopener"
                >
                  AGCO: „{text}“ suchen
                </a>
              )}
              {cartButton}
              <Button variant="secondary" onClick={() => void fromClipboard()}>
                <ClipboardPaste aria-hidden className="h-5 w-5" />
                Teilenummer aus Zwischenablage
              </Button>
            </div>
            {catalogs.some((c) => c.handBack) && (
              <p className="text-sm text-text-muted">
                <strong className="text-text">So geht’s:</strong> Katalog öffnen, Teile in den Warenkorb legen
                und im Katalog den Warenkorb übergeben – die Teile erscheinen hier mit Menge.
              </p>
            )}
            <p className="text-sm text-text-muted">
              Teilenummer im Katalog markieren und <strong className="text-text">hierher ziehen</strong> –
              oder kopieren und „Teilenummer aus Zwischenablage“ tippen.
            </p>
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
            {catalogListView}
          </section>
        </>
      )}

      {embed && (
        <div
          role="region"
          aria-label="AGCO-Teilekatalog"
          data-testid="catalog-embed"
          className="flex h-[calc(100dvh-23rem)] min-h-[26rem] flex-col overflow-hidden rounded-card border-2 border-border bg-surface lg:h-[calc(100dvh-10.5rem)]"
        >
          <div
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
            data-testid="catalog-embed-drop"
            className={`flex flex-wrap items-center gap-2 border-b-2 px-3 py-2 transition-colors ${
              dropActive ? 'border-dashed border-primary bg-success-bg' : 'border-border bg-surface'
            }`}
          >
            <Button variant="secondary" onClick={() => setEmbedOpen(false)}>
              <ArrowLeft aria-hidden className="h-5 w-5" />
              Zurück
            </Button>
            <span className="min-w-0 flex-1 basis-40 text-sm font-semibold">
              {dropActive
                ? 'Loslassen – Teilenummer wird übernommen'
                : 'Teilenummer markieren und hierher ziehen'}
            </span>
            <label className="sr-only" htmlFor="paste-embed">
              Teilenummer einfügen
            </label>
            <input
              id="paste-embed"
              className={`${field} w-44`}
              placeholder="… oder einfügen"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void resolvePaste()}
              onPaste={(e) => {
                e.preventDefault();
                void ingest(e.clipboardData.getData('text/plain'));
              }}
            />
            {cartButton}
            <Button
              variant="secondary"
              onClick={() => void fromClipboard()}
              aria-label="Teilenummer aus Zwischenablage"
            >
              <ClipboardPaste aria-hidden className="h-5 w-5" />
              <span className="hidden sm:inline">Zwischenablage</span>
            </Button>
            {cart.length > 0 && (
              <Button onClick={() => setEmbedOpen(false)}>Warenkorb ({cart.length})</Button>
            )}
          </div>
          <iframe
            title={`${embed.label.split(' (')[0]}-Teilekatalog`}
            src={embed.src}
            className="min-h-0 w-full flex-1 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="strict-origin"
            allow="clipboard-write"
          />
          {embedPanel && (results.length > 0 || catalogList.length > 0) && (
            <div
              aria-label="Übernommene Teile"
              className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto border-t-4 border-primary bg-surface-muted p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">Übernommen{text ? `: ${text}` : ''}</h2>
                <Button variant="ghost" onClick={() => setEmbedPanel(false)} aria-label="Ergebnis ausblenden">
                  <X aria-hidden className="h-5 w-5" />
                </Button>
              </div>
              {catalogListView}
              {resultList}
            </div>
          )}
        </div>
      )}
      {!embedOpen && cart.length > 0 && (
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

      {cartAi && (
        <input
          ref={cartFile}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Bildschirmfoto des Warenkorbs"
          data-testid="cart-image"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void shrinkImageFile(f).then(readCart, () => toast('Bild nicht lesbar'));
          }}
        />
      )}
      <TractorMagic busy={cartBusy} />
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
