'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TractorArt } from '@/components/TractorArt';
import { config } from '@/lib/config';

/** Page text from the fragment (base64url of UTF-8), as put there by the bookmark. */
function decodePayload(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * Opened by the bookmark "→ Werkstatt-App" on the shop's cart page (E-78): hands the page text to the API with the
 * personal link token. No sign-in here. The Monteur's app then picks the cart up by itself.
 */
export default function SendCartPage() {
  const [state, setState] = useState<{ kind: 'busy' | 'ok' | 'empty' | 'error'; text?: string; n?: number }>({
    kind: 'busy',
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // The token must not stay in the browser history.
    history.replaceState(null, '', window.location.pathname);
    const token = params.get('t');
    const payload = params.get('p');
    if (!token || !payload) {
      setState({
        kind: 'error',
        text: 'Dieses Fenster öffnet das Lesezeichen „→ Werkstatt-App“ im AGCO-Warenkorb.',
      });
      return;
    }
    let text = '';
    try {
      text = decodePayload(payload);
    } catch {
      setState({ kind: 'error', text: 'Die Seite konnte nicht gelesen werden.' });
      return;
    }
    fetch(`${config.apiUrl}/v1/parts/shop-cart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, text }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { lines?: number; message?: string };
        if (!res.ok) throw new Error(body.message ?? 'Senden fehlgeschlagen');
        if (!body.lines) return setState({ kind: 'empty' });
        setState({ kind: 'ok', n: body.lines });
        // Opened as a small window from the shop: close it again.
        if (window.opener) setTimeout(() => window.close(), 2500);
      })
      .catch((e: Error) => setState({ kind: 'error', text: e.message }));
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <TractorArt
        className={`h-24 w-36 ${state.kind === 'busy' ? 'motion-safe:animate-bounce' : ''}`}
        spin={state.kind === 'busy'}
      />
      {state.kind === 'busy' && (
        <p className="text-lg font-semibold">Warenkorb wird an die Werkstatt-App geschickt …</p>
      )}
      {state.kind === 'ok' && (
        <>
          <p className="flex items-center gap-2 text-xl font-bold text-success">
            <CircleCheck aria-hidden className="h-7 w-7" /> {state.n}{' '}
            {state.n === 1 ? 'Position' : 'Positionen'} geschickt
          </p>
          <p>
            Jetzt einfach zurück in die Werkstatt-App wechseln – die Teile stehen dort schon im Auftrag
            bereit.
          </p>
        </>
      )}
      {state.kind === 'empty' && (
        <p className="flex items-start gap-2 font-semibold text-warning">
          <CircleAlert aria-hidden className="h-6 w-6 shrink-0" />
          Auf dieser Seite wurde kein Warenkorb erkannt. Bitte das Lesezeichen auf der Warenkorb-Seite des
          Shops tippen.
        </p>
      )}
      {state.kind === 'error' && (
        <p className="flex items-start gap-2 font-semibold text-danger">
          <CircleAlert aria-hidden className="h-6 w-6 shrink-0" />
          {state.text}
        </p>
      )}
    </main>
  );
}
