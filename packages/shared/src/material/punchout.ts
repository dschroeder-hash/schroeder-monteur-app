/**
 * Manufacturer catalogs with cart hand-back (E-80), as the Schröder parts shop does it: the app opens the dealer
 * catalog (AGCO partsbook in a frame, Grimme on agroparts in a window) with a return address (OCI "HOOK_URL");
 * the catalog sends the finished cart there as an OCI form (NEW_ITEM-* fields). The app never reads catalog pages.
 */
export interface CatalogDef {
  id: string;
  label: string;
  /** Service item brands the catalog is offered for (empty = always). */
  brands: string[];
  /** Catalog address. `{HOOK_URL}` is replaced by the URL-encoded return address; without it there is no hand-back. */
  url: string;
  /** 'iframe': shown large inside the parts page; 'popup': own window (catalogs that need popups for the cart). */
  mode: 'iframe' | 'popup';
}

/** Defaults until the dealer access (OP-51) is configured: catalog start pages without hand-back. */
export const DEFAULT_CATALOGS: CatalogDef[] = [
  {
    id: 'agco',
    label: 'AGCO (Fendt, Valtra, Massey Ferguson)',
    brands: ['FENDT', 'VALTRA', 'MF', 'AGCO'],
    url: 'https://parts.agcocorp.com/de/de/dealers/redirect/schroeder11',
    mode: 'iframe',
  },
  {
    id: 'grimme',
    label: 'Grimme',
    brands: ['GRIMME'],
    url: 'https://www.agroparts.com/ip40_grimme/',
    mode: 'popup',
  },
];

export const catalogHasHandBack = (c: CatalogDef) => c.url.includes('{HOOK_URL}');

export function catalogUrl(c: CatalogDef, hookUrl: string | null): string {
  return c.url.replace('{HOOK_URL}', hookUrl ? encodeURIComponent(hookUrl) : '');
}

export interface CartLine {
  partNo: string;
  quantity: number;
  name: string | null;
}

/**
 * Cart from an OCI hand-back (SAP Open Catalog Interface): NEW_ITEM-<FIELD>[n] per line. Part number from
 * VENDORMAT (supplier part number), else MATNR / EXT_PRODUCT_ID; quantity from QUANTITY (decimal point or comma);
 * name from DESCRIPTION. Lines without part number are skipped, duplicates summed, at most 200 lines.
 */
export function parseOciCart(fields: Record<string, unknown>): CartLine[] {
  const rows = new Map<number, Record<string, string>>();
  for (const [rawKey, rawValue] of Object.entries(fields)) {
    const m = /^NEW_ITEM-([A-Z_]+)\[(\d{1,4})\]$/i.exec(rawKey.trim());
    if (!m) continue;
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    if (typeof value !== 'string') continue;
    const i = Number(m[2]);
    const row = rows.get(i) ?? {};
    row[m[1]!.toUpperCase()] = value.trim();
    rows.set(i, row);
  }
  const out = new Map<string, CartLine>();
  for (const i of [...rows.keys()].sort((a, b) => a - b)) {
    const r = rows.get(i)!;
    const partNo = (r.VENDORMAT || r.MATNR || r.EXT_PRODUCT_ID || '').replace(/\s+/g, ' ').slice(0, 40);
    if (!partNo || !/[0-9]/.test(partNo)) continue;
    const q = parseQuantity(r.QUANTITY);
    const key = partNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const prev = out.get(key);
    if (prev) prev.quantity = Math.min(9999, prev.quantity + q);
    else out.set(key, { partNo, quantity: q, name: r.DESCRIPTION?.slice(0, 120) || null });
    if (out.size >= 200) break;
  }
  return [...out.values()];
}

/** "1", "2.000", "2,000", "1.5" → number; whole parts rounded up to at least 1 (fluids may be fractional). */
function parseQuantity(s: string | undefined): number {
  if (!s) return 1;
  const t = s.replace(/\s/g, '');
  // "1.234,5" (German) or "1,234.5" (English) – the last separator is the decimal one.
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  const normal = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(normal);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(9999, Math.round(n * 1000) / 1000);
}
