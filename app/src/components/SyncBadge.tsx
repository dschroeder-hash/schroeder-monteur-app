'use client';

import type { SyncStatus } from '@/lib/offline/useSyncStatus';

function ago(d: Date | null): string {
  if (!d) return 'noch nie';
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} min`;
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Visible sync state in the header: online/offline, pending entries, last sync (ARCHITEKTUR 4). */
export function SyncBadge({ status }: { status: SyncStatus }) {
  const { online, pending, lastSync } = status;
  const tone = !online
    ? 'bg-warning-bg text-warning'
    : pending > 0
      ? 'bg-info-bg text-info'
      : 'bg-success-bg text-success';
  const label = !online ? 'Offline' : pending > 0 ? 'Synchronisiere' : 'Online';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${tone}`}
    >
      <span
        aria-hidden
        className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-current' : 'border-2 border-current'}`}
      />
      <span>{label}</span>
      {pending > 0 && <span>· {pending} ausstehend</span>}
      <span className="hidden font-normal sm:inline">· Sync {ago(lastSync)}</span>
    </div>
  );
}
