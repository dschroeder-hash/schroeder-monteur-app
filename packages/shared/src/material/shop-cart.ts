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
 * Body of the bookmark (runs on the shop page, not in the app). A cart line is an element with "Teilenr." whose
 * own row (the nearest ancestor that holds no other part number) has a quantity – an input field or
 * "n X … € pro Stück". Recommended or recently viewed articles have no quantity there and are skipped. If nothing is found, the page text is copied instead (the app then
 * falls back to recognising part numbers in it).
 */
const BOOKMARKLET_BODY = `(()=>{const M=${JSON.stringify(SHOP_CART_MARKER)};const re=/Teile?-?nr\\.?\\s*:?\\s*([A-Z0-9][A-Z0-9.\\-\\/]{3,30})/i;const out=[];const seen=new Set();
for(const e of document.querySelectorAll('body *')){if(e.children.length)continue;const m=re.exec(e.textContent||'');if(!m)continue;const no=m[1];let row=e,q=null;
for(let i=0;i<8;i++){row=row.parentElement;if(!row)break;if(((row.innerText||'').match(/Teile?-?nr/gi)||[]).length>1)break;const inp=[...row.querySelectorAll('input')].find(x=>/^\\d{1,3}$/.test(x.value));if(inp){q=+inp.value;break}const t=/(\\d{1,3})\\s*[xX×]\\s*[\\d.,]+\\s*€/.exec(row.innerText||'');if(t){q=+t[1];break}}
if(q===null||seen.has(no))continue;seen.add(no);out.push(no+'\\t'+q)}
const txt=out.length?M+'\\n'+out.join('\\n'):(document.body.innerText||'').slice(0,30000);
const done=()=>alert(out.length?out.length+' Positionen kopiert. Jetzt in der Werkstatt-App „Warenkorb übertragen“ tippen.':'Kein Warenkorb erkannt – Seitentext kopiert.');
navigator.clipboard.writeText(txt).then(done,()=>prompt('Bitte diesen Text kopieren:',txt))})()`;

export const SHOP_CART_BOOKMARKLET = `javascript:${encodeURI(BOOKMARKLET_BODY.replace(/\n/g, ''))}`;
