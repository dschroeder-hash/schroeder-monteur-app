'use client';

import { useState } from 'react';
import { toast } from '@/components/Toast';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * "Aus BC aktualisieren" (E-61): asks the worker to re-read this order from Business Central now instead of waiting
 * for the regular sync (every 3 min). `onRequested` lets the page reload/sync a few seconds later.
 */
export function RefreshFromBc({ orderId, onRequested }: { orderId: string; onRequested?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="min-h-touch self-start text-sm font-semibold underline disabled:opacity-50"
      disabled={busy}
      onClick={async () => {
        if (!navigator.onLine) return toast('Offline – die Aktualisierung aus BC braucht eine Verbindung.');
        setBusy(true);
        try {
          await apiFetch(`/v1/orders/${orderId}/refresh`, { method: 'POST' });
          toast('Aktualisierung aus BC angefordert – die Daten sind in wenigen Sekunden da.');
          if (onRequested) setTimeout(onRequested, 12_000);
        } catch (e) {
          toast(e instanceof ApiError ? e.message : 'Aktualisierung fehlgeschlagen');
        } finally {
          setBusy(false);
        }
      }}
    >
      ↻ Aus BC aktualisieren
    </button>
  );
}
