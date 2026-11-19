'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { localDb } from './db';

export interface SyncStatus {
  online: boolean;
  pending: number;
  lastSync: Date | null;
}

/** Online state, number of unsent outbox entries and time of the last successful sync (header badge). */
export function useSyncStatus(ownerOid: string | undefined): SyncStatus {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const pending =
    useLiveQuery(
      () =>
        ownerOid
          ? localDb.outbox
              .where('ownerOid')
              .equals(ownerOid)
              .filter((e) => e.status !== 'rejected')
              .count()
          : 0,
      [ownerOid],
    ) ?? 0;
  const last = useLiveQuery(() => localDb.kv.get('lastSync'), []);
  return { online, pending, lastSync: last?.value ? new Date(String(last.value)) : null };
}
