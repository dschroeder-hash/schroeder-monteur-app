/**
 * Manufacturer parts catalogs (PROMPT 5.5). AGCO integration is deep link only: the app opens the catalog
 * in a new tab and never fetches, scrapes or parses catalog pages. The adapter interface leaves room for a
 * later data integration (AGCO MDI) without changing callers.
 */
export interface CatalogSearch {
  partNo?: string | null;
  serialNo?: string | null;
}

export interface PartsCatalogAdapter {
  id: string;
  label: string;
  /** Brands (service item manufacturer codes) this catalog is offered for. */
  brands: string[];
  /** URL to open in a new tab, or null if nothing to search. Never called server-side. */
  buildSearchUrl(q: CatalogSearch): string | null;
  /** true if the URL already contains the search; otherwise the app copies the query to the clipboard. */
  searchInUrl: boolean;
  /** Start page of the catalog (always offered, also without a part or serial number); null if not https. */
  startUrl: string | null;
}

/**
 * AGCO Parts catalog (German site). The search URL format is not known yet (OFFENE-PUNKTE OP-24): without a
 * `{query}` placeholder the catalog start page is opened and the app copies the part/serial number to the
 * clipboard. Once the search URL is known, set setting `partsCatalogs.agcoTemplate`, e.g. `…?q={query}`.
 */
export const AGCO_DEFAULT_TEMPLATE = 'https://parts.agcocorp.com/de/de/';

export function agcoDeeplinkAdapter(template = AGCO_DEFAULT_TEMPLATE): PartsCatalogAdapter {
  return {
    id: 'agco',
    label: 'AGCO Parts (Fendt, Valtra, Massey Ferguson)',
    brands: ['FENDT', 'VALTRA', 'MF', 'AGCO'],
    searchInUrl: template.includes('{query}'),
    startUrl: catalogStartUrl(template),
    buildSearchUrl({ partNo, serialNo }) {
      const query = (partNo || serialNo || '').trim();
      if (!query) return null;
      const url = template.includes('{query}')
        ? template.replace('{query}', encodeURIComponent(query))
        : template;
      // Only plain https links to the configured shop – no data is sent anywhere else.
      return url.startsWith('https://') ? url : null;
    },
  };
}

function catalogStartUrl(template: string): string | null {
  if (!template.startsWith('https://')) return null;
  if (!template.includes('{query}')) return template;
  // No URL class here: this package is built without DOM/Node types.
  const origin = /^https:\/\/[^/?#\s{}]+/i.exec(template)?.[0];
  return origin ? `${origin.toLowerCase()}/` : null;
}

/** Canonical form for comparing part numbers ("X548.880.400" ≙ "x548 880-400"). */
export function normalizePartNo(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Extracts a plausible part number from pasted text or a scanned code (clipboard often contains
 * "Teilenummer: X548.880.400 – Keilrippenriemen").
 */
export function extractPartNo(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const labelled =
    /(?:teile?-?nr\.?|teilenummer|part\s*(?:no|number)\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9.\-/ ]{2,30}[A-Z0-9])/i.exec(
      t,
    );
  if (labelled?.[1]) return labelled[1].trim();
  const token = t.split(/[\s,;|–]+/).find((w) => /\d/.test(w) && w.replace(/[^A-Za-z0-9]/g, '').length >= 4);
  return token ? token.replace(/[^A-Za-z0-9.\-/]/g, '') : null;
}
