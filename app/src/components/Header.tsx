'use client';

import { ROLE_LABELS } from '@schroeder/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useSyncStatus } from '@/lib/offline/useSyncStatus';
import { config } from '@/lib/config';
import { SyncBadge } from './SyncBadge';
import { ThemeToggle } from './ThemeToggle';

export function Header() {
  const { me, logout, offlineSession } = useAuth();
  const sync = useSyncStatus(me?.id);
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
        <Link href="/" className="flex min-h-touch items-center text-text" aria-label="Startseite">
          <img
            src={`${config.basePath}/brand/logo.svg`}
            alt="Schröder Landmaschinen"
            className="h-10 w-auto rounded-md bg-white px-1"
          />
        </Link>
        <div className="flex items-center gap-2">
          <SyncBadge status={sync} />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="user-menu"
            className="min-h-touch min-w-touch rounded-full border border-border px-3 font-semibold"
          >
            {me?.displayName
              ?.split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('') ?? '?'}
            <span className="sr-only">Benutzermenü</span>
          </button>
        </div>
      </div>
      {offlineSession && (
        <p className="bg-warning-bg px-4 py-2 text-center text-sm font-semibold text-warning">
          Keine Verbindung zum Server – Sie arbeiten offline. Alles wird gespeichert und später übertragen.
        </p>
      )}
      {open && me && (
        <div
          id="user-menu"
          className="mx-auto flex max-w-6xl flex-col gap-3 border-t border-border px-4 py-3"
        >
          <div>
            <p className="font-semibold">{me.displayName}</p>
            <p className="text-sm text-text-muted">
              {me.roles.map((r) => ROLE_LABELS[r]).join(', ')} ·{' '}
              {me.grants
                .map((g) => g.location?.name)
                .filter(Boolean)
                .join(', ') || 'kein Standort'}
            </p>
          </div>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void logout()}
            className="min-h-touch self-start rounded-card border border-border px-4 font-semibold"
          >
            Abmelden
          </button>
        </div>
      )}
    </header>
  );
}
