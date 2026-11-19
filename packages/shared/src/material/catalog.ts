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
}

/** Default search URL – to be confirmed with AGCO (OFFENE-PUNKTE OP-24); configurable via setting `partsCatalogs`. */
export const AGCO_DEFAULT_TEMPLATE = 'https://shop.agcoparts.com/search?text={query}';

export function agcoDeeplinkAdapter(template = AGCO_DEFAULT_TEMPLATE): PartsCatalogAdapter {
  return {
    id: 'agco',
    label: 'AGCO Parts (Fendt, Valtra, Massey Ferguson)',
    brands: ['FENDT', 'VALTRA', 'MF', 'AGCO'],
    buildSearchUrl({ partNo, serialNo }) {
      const query = (partNo || serialNo || '').trim();
      if (!query) return null;
      const url = template.replace('{query}', encodeURIComponent(query));
      // Only plain https links to the configured shop – no data is sent anywhere else.
      return url.startsWith('https://') ? url : null;
    },
  };
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
