'use client';

import { ROLES, type CommandPayload, type CommandType } from '@schroeder/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { apiFetch } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { localDb } from './db';
import { recordCommand, syncNow } from './sync';

interface SyncContextValue {
  /** Records a command locally (works offline) and schedules a sync. */
  run: <T extends CommandType>(type: T, payload: CommandPayload<T>) => Promise<string>;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);
const INTERVAL_MS = 60_000;

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync outside SyncProvider');
  return ctx;
}

/** Runs the offline sync for users with the Monteur role. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const ownerId = me?.id;
  const enabled = !!me && me.roles.includes(ROLES.Monteur) && me.grants.some((g) => g.role === 'MONTEUR');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSync = useCallback(async () => {
    if (!enabled || !ownerId || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    await syncNow(localDb, ownerId, apiFetch).catch(() => undefined);
  }, [enabled, ownerId]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void doSync(), 500);
  }, [doSync]);

  useEffect(() => {
    if (!enabled) return;
    void doSync();
    const onVisible = () => document.visibilityState === 'visible' && void doSync();
    window.addEventListener('online', doSync);
    document.addEventListener('visibilitychange', onVisible);
    const iv = setInterval(() => void doSync(), INTERVAL_MS);
    return () => {
      window.removeEventListener('online', doSync);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(iv);
    };
  }, [enabled, doSync]);

  const run = useCallback(
    async <T extends CommandType>(type: T, payload: CommandPayload<T>) => {
      if (!ownerId) throw new Error('Nicht angemeldet');
      const id = await recordCommand(localDb, ownerId, type, payload);
      schedule();
      return id;
    },
    [ownerId, schedule],
  );

  const value = useMemo(() => ({ run, syncNow: doSync }), [run, doSync]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
