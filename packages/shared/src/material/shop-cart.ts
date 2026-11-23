/**
 * "Warenkorb kopieren" (E-77): a browser bookmark (bookmarklet) that runs on the manufacturer shop's cart page,
 * reads every cart line – also the ones scrolled out of view – and copies them in a small text format to the
 * clipboard. The app's "Warenkorb übertragen" reads that format. The app itself never reads the shop page.
 */
export const SHOP_CART_MARKER = 'WERKSTATT-APP-WARENKORB v1';

export interface ShopCartLine {
  partNo: string;
  quantity: number;
}

/** Lines copied by the bookmark (marker + "partNo<TAB>quantity" per line); null if the text is something else. */
export function parseShopCart(text: string): ShopCartLine[] | null {
  const lines = text.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => l.trim() === SHOP_CART_MARKER);
  if (start < 0) return null;
  const out = new Map<string, ShopCartLine>();
  for (const l of lines.slice(start + 1)) {
    const [no, qty] = l.split('\t');
    const partNo = (no ?? '').trim();
    if (!partNo || !/[0-9]/.test(partNo) || partNo.length > 40) continue;
    const quantity = Math.min(999, Math.max(1, Math.round(Number(qty) || 1)));
    const key = partNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const prev = out.get(key);
    if (prev) prev.quantity = Math.min(999, prev.quantity + quantity);
    else out.set(key, { partNo, quantity });
  }
  return [...out.values()];
}

/**
 * Cart lines from the plain text of the shop's cart page (what the bookmark copies, or what a Monteur copied with
 * "select all"). A line starts at "Teilenr." (the number on the same or the next line) and counts only if a
 * quantity follows before the next part number: "1 X 2,32 € pro Stück". Recommended or recently viewed articles
 * show no such quantity and are skipped.
 */
export function parseShopCartText(text: string): ShopCartLine[] {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const found: ShopCartLine[] = [];
  let cur: { no: string | null; q: number | null } | null = null;
  const flush = () => {
    if (cur?.no && cur.q) found.push({ partNo: cur.no, quantity: cur.q });
    cur = null;
  };
  for (const l of lines) {
    const m = /Teile?-?nr\.?\s*:?\s*([A-Z0-9][A-Z0-9.\-/]{3,30})?/i.exec(l);
    if (m) {
      flush();
      cur = { no: m[1] && /\d/.test(m[1]) ? m[1] : null, q: null };
      continue;
    }
    if (!cur) continue;
    const c: { no: string | null; q: number | null } = cur;
    if (!c.no && /^[A-Z0-9][A-Z0-9.\-/]{3,30}$/i.test(l) && /\d/.test(l)) c.no = l;
    else if (c.q === null) {
      const q = /^(\d{1,3})\s*[xX×]\s*[\d.,]+\s*€/.exec(l);
      if (q) c.q = Number(q[1]);
    }
  }
  flush();
  return (
    parseShopCart(`${SHOP_CART_MARKER}\n${found.map((f) => `${f.partNo}\t${f.quantity}`).join('\n')}`) ?? []
  );
}

/**
 * Personal bookmark "→ Werkstatt-App" (E-78). It runs on the shop's cart page, takes the page's visible text (the
 * whole page, also below the fold) and opens the app page /warenkorb-senden with it and the personal link token
 * in the URL fragment (never sent to a server log). That page hands it to the API; the Monteur's app picks the
 * recognised lines up by itself. Navigation instead of a request from the shop page, so the shop's security
 * rules (CSP) cannot block it.
 */
export function shopCartBookmarklet(appBaseUrl: string, token: string): string {
  const target = `${appBaseUrl.replace(/\/$/, '')}/warenkorb-senden#t=${encodeURIComponent(token)}&p=`;
  const body = `(()=>{const t=(document.body.innerText||'').slice(0,60000);const b=btoa(unescape(encodeURIComponent(t))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');const u=${JSON.stringify(target)}+b;if(!window.open(u,'werkstatt-app-warenkorb'))location.href=u})()`;
  return `javascript:${encodeURI(body)}`;
}
