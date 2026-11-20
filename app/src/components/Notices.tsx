'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/offline/db';

const tone = {
  warning: 'bg-warning-bg text-warning',
  info: 'bg-info-bg text-info',
  error: 'bg-danger-bg text-danger',
} as const;

/** Persistent hints from the sync (planning changed, rejected entries, clock skew). Dismissable. */
export function Notices() {
  const notices = useLiveQuery(() => localDb.notices.orderBy('at').reverse().limit(5).toArray(), []) ?? [];
  if (!notices.length) return null;
  return (
    <section aria-label="Hinweise" className="flex flex-col gap-2">
      {notices.map((n) => (
        <div
          key={n.id}
          role={n.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-3 rounded-card p-3 ${tone[n.kind]}`}
        >
          <p className="font-medium">{n.text}</p>
          <button
            type="button"
            onClick={() => void localDb.notices.delete(n.id)}
            className="min-h-touch min-w-touch shrink-0 rounded-card font-semibold underline"
          >
            OK
          </button>
        </div>
      ))}
    </section>
  );
}
