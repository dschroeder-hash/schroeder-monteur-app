'use client';

import { ROLE_LABELS, ROLES } from '@schroeder/shared';
import { Download, LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { apiFetch } from '@/lib/api';
import { config } from '@/lib/config';
import { useSyncStatus } from '@/lib/offline/useSyncStatus';
import { InstallHint } from './InstallHint';
import { isActive, navGroups, type NavGroup } from './nav-items';
import { NotificationBell } from './NotificationBell';
import { StampBar } from './StampBar';
import { SyncBadge } from './SyncBadge';
import { ThemeToggle } from './ThemeToggle';
import { toast, ToastHost } from './Toast';

/** Self-service export (Art. 15 DSGVO): everything stored about the signed-in user as JSON file. */
async function downloadMyData() {
  try {
    const data = await apiFetch<unknown>('/v1/me/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `monteur-app-daten-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    toast('Export nicht möglich – bitte mit Verbindung erneut versuchen.');
  }
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex min-h-touch items-center gap-3 text-nav-text" aria-label="Startseite">
      <img src={`${config.basePath}/icons/icon-192.png`} alt="" className="h-10 w-10 shrink-0 rounded-lg" />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-lg font-bold">Schröder</span>
          <span className="block text-xs text-nav-text-muted">Werkstatt-App</span>
        </span>
      )}
    </Link>
  );
}

/**
 * Navigation list. `rail`: narrow icon bar with short labels (iPad portrait), otherwise icon + full label
 * (iPad landscape, phone drawer). Large touch targets (≥ 56 px) for gloves.
 */
function NavList({
  groups,
  rail,
  onNavigate,
}: {
  groups: NavGroup[];
  rail?: boolean;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  return (
    <nav aria-label="Hauptnavigation" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-1">
          {groups.length > 1 && !rail && (
            <p className="px-3 pt-1 text-xs font-bold uppercase tracking-wider text-nav-text-muted">
              {g.title}
            </p>
          )}
          {groups.length > 1 && rail && <hr className="mx-3 border-nav-text-muted/30" />}
          <ul className="flex flex-col gap-1">
            {g.items.map((i) => {
              const active = isActive(i, path);
              const Icon = i.icon;
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    aria-label={rail ? i.label : undefined}
                    className={`flex rounded-xl font-semibold transition-colors ${
                      rail
                        ? 'min-h-16 flex-col items-center justify-center gap-1 px-1 text-center text-xs'
                        : 'min-h-14 items-center gap-3 px-3 text-base'
                    } ${
                      active ? 'bg-nav-active-bg text-nav-active-text' : 'text-nav-text hover:bg-white/10'
                    }`}
                  >
                    <Icon aria-hidden className={rail ? 'h-6 w-6' : 'h-6 w-6 shrink-0'} strokeWidth={2.2} />
                    <span>{rail ? (i.short ?? i.label) : i.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const initials = me.displayName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="user-menu"
        className="min-h-touch min-w-touch rounded-full bg-primary px-3 font-bold text-on-primary"
      >
        {initials || '?'}
        <span className="sr-only">Benutzermenü</span>
      </button>
      {open && (
        <div
          id="user-menu"
          className="absolute right-0 top-full z-40 mt-2 flex w-72 flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-xl"
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
            onClick={() => void downloadMyData()}
            className="flex min-h-touch items-center gap-2 self-start text-sm font-semibold"
          >
            <Download aria-hidden className="h-5 w-5" /> Meine Daten herunterladen
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="flex min-h-touch items-center gap-2 self-start rounded-card border-2 border-border px-4 font-semibold"
          >
            <LogOut aria-hidden className="h-5 w-5" /> Abmelden
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * App frame: dark side navigation on the left (iPad landscape: full width with labels, iPad portrait: icon rail),
 * on phones a menu button opens the same navigation as a drawer. Stamping sits at the bottom of the side
 * navigation (landscape) or in a bar at the bottom of the screen.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { me, offlineSession } = useAuth();
  const sync = useSyncStatus(me?.id);
  const path = usePathname();
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const groups = me ? navGroups(me.roles, me.features) : [];
  const stamping = !!me?.features.stamping && !!me?.roles.includes(ROLES.Monteur);
  const stampBar = stamping && path.startsWith('/monteur');

  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!drawer) return;
    drawerRef.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  return (
    <div className="min-h-dvh md:pl-24 lg:pl-64">
      {/* iPad: permanent side navigation */}
      <aside
        aria-label="Navigation"
        className="fixed inset-y-0 left-0 z-30 hidden w-24 flex-col gap-4 overflow-y-auto bg-nav-bg px-2 py-3 md:flex lg:w-64 lg:px-3"
      >
        <div className="flex justify-center lg:hidden">
          <Brand compact />
        </div>
        <div className="hidden px-1 lg:block">
          <Brand />
        </div>
        <div className="lg:hidden">
          <NavList groups={groups} rail />
        </div>
        <div className="hidden lg:block">
          <NavList groups={groups} />
        </div>
        {stamping && (
          <div className="mt-auto hidden border-t border-white/15 pt-3 lg:block">
            <StampBar variant="panel" />
          </div>
        )}
      </aside>

      {/* Phone: drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Navigation schließen"
            onClick={() => setDrawer(false)}
          />
          <div
            ref={drawerRef}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-nav-bg px-3 py-3"
          >
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="min-h-touch min-w-touch rounded-full text-nav-text"
                aria-label="Navigation schließen"
              >
                <X aria-hidden className="mx-auto h-6 w-6" />
              </button>
            </div>
            <NavList groups={groups} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 lg:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-expanded={drawer}
              className="flex min-h-touch items-center gap-2 rounded-card bg-nav-bg px-3 font-semibold text-nav-text"
            >
              <Menu aria-hidden className="h-6 w-6" />
              Menü
            </button>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <SyncBadge status={sync} />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
        <InstallHint />
        {offlineSession && (
          <p className="bg-warning-bg px-4 py-2 text-center text-sm font-semibold text-warning">
            Keine Verbindung zum Server – Sie arbeiten offline. Alles wird gespeichert und später übertragen.
          </p>
        )}
      </header>

      <main className={`mx-auto max-w-6xl px-4 pt-5 lg:px-8 ${stampBar ? 'pb-52 lg:pb-10' : 'pb-10'}`}>
        {children}
      </main>

      <ToastHost />
      {stampBar && (
        <div className="lg:hidden">
          <StampBar variant="bar" />
        </div>
      )}
    </div>
  );
}
