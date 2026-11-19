'use client';

import { ACTIVITY_LABELS } from '@schroeder/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fmtMinutes, fmtTime } from '@/lib/format';
import { localDb } from '@/lib/offline/db';
import { useNow, useStampState, useTimezone } from '@/lib/offline/hooks';
import { useSync } from '@/lib/offline/SyncProvider';
import { Button } from './ui/Button';

/**
 * Sticky stamp bar (CD section 8): the core actions are always reachable with one hand and gloves,
 * max. 2 taps. Works offline – every tap is stored locally first.
 */
export function StampBar() {
  const { me } = useAuth();
  const { run } = useSync();
  const tz = useTimezone();
  const now = useNow(15_000);
  const st = useStampState(me?.id);
  const [overheadOpen, setOverheadOpen] = useState(false);
  const overheads = useLiveQuery(() => localDb.overheadTypes.filter((o) => o.active).toArray(), []) ?? [];
  if (!me) return null;

  const running = st.job;
  const minutes = running ? (now.getTime() - Date.parse(running.start)) / 60_000 : 0;

  return (
    <div
      className="fixed inset-x-0 bottom-16 z-30 border-t border-border bg-surface/95 px-4 pb-3 pt-2 backdrop-blur"
      aria-label="Stempeln"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {running && (
          <Link
            href={running.orderId ? `/monteur/auftrag?id=${running.orderId}` : '/monteur/zeiten'}
            className="flex items-center justify-between rounded-card border-l-[6px] border-l-accent bg-surface-muted px-3 py-2"
          >
            <span className="font-semibold">
              {running.kind === 'ORDER'
                ? `${st.order?.bcNo ?? 'Auftrag'} · ${ACTIVITY_LABELS[running.activity!]}`
                : (overheads.find((o) => o.code === running.overheadCode)?.label ?? 'Gemeinkosten')}
            </span>
            <span className="font-emphasis text-xl tabular-nums" aria-label="Laufzeit">
              {fmtMinutes(minutes)}
            </span>
          </Link>
        )}
        {st.onBreak && (
          <p className="text-center font-semibold text-warning">
            Pause seit {fmtTime(st.onBreak.start, tz)} Uhr
          </p>
        )}

        {overheadOpen && (
          <div role="dialog" aria-label="Gemeinkosten wählen" className="grid grid-cols-2 gap-2">
            {overheads.map((o) => (
              <Button
                key={o.code}
                variant="secondary"
                onClick={() => {
                  setOverheadOpen(false);
                  void run('StampOverheadStart', { overheadCode: o.code });
                }}
              >
                {o.label}
              </Button>
            ))}
          </div>
        )}

        <div className="grid grid-flow-col auto-cols-fr gap-2">
          {!st.clockedIn && (
            <Button size="lg" onClick={() => void run('StampClockIn', {})}>
              Kommen
            </Button>
          )}
          {st.clockedIn && st.onBreak && (
            <Button size="lg" onClick={() => void run('StampBreakStop', {})}>
              Pause beenden
            </Button>
          )}
          {st.clockedIn && !st.onBreak && (
            <>
              {running?.kind === 'ORDER' && (
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => void run('StampJobStop', { orderId: running.orderId! })}
                >
                  Stopp
                </Button>
              )}
              {running?.kind === 'OVERHEAD' && (
                <Button size="lg" variant="secondary" onClick={() => void run('StampOverheadStop', {})}>
                  Stopp
                </Button>
              )}
              {!running && (
                <Button
                  size="lg"
                  variant="secondary"
                  aria-expanded={overheadOpen}
                  onClick={() => setOverheadOpen((o) => !o)}
                >
                  Gemeinkosten
                </Button>
              )}
              <Button size="lg" variant="secondary" onClick={() => void run('StampBreakStart', {})}>
                Pause
              </Button>
              <Button size="lg" variant="danger" onClick={() => void run('StampClockOut', {})}>
                Gehen
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
