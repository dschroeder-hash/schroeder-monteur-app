'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { enablePush, pushState } from '@/lib/push';

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** In-app notifications (also delivered as Web Push when enabled). */
export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState<'unsupported' | 'denied' | 'off' | 'on'>('off');
  const load = useCallback(async () => {
    if (!navigator.onLine) return;
    setItems(await apiFetch<Notification[]>('/v1/notifications').catch(() => []));
  }, []);
  useEffect(() => {
    void load();
    void pushState().then(setPush);
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);
  const unread = items.filter((n) => !n.readAt).length;
  const toggle = async () => {
    setOpen((o) => !o);
    if (!open && unread) {
      await apiFetch('/v1/notifications/read', { method: 'POST', body: JSON.stringify({ all: true }) }).catch(
        () => undefined,
      );
      setTimeout(() => void load(), 3000);
    }
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-label={`Benachrichtigungen${unread ? `, ${unread} neu` : ''}`}
        className="relative min-h-touch min-w-touch rounded-full border border-border"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-danger px-1.5 text-xs font-bold text-surface">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[90vw] rounded-card border border-border bg-surface p-2 shadow-lg">
          {push === 'off' && (
            <button
              type="button"
              className="mb-2 min-h-touch w-full rounded-card bg-primary px-3 font-semibold text-on-primary"
              onClick={() => void enablePush().then(setPush)}
            >
              Push-Benachrichtigungen aktivieren
            </button>
          )}
          {push === 'denied' && (
            <p className="mb-2 text-sm text-warning">Benachrichtigungen sind im Browser blockiert.</p>
          )}
          {push === 'unsupported' && (
            <p className="mb-2 text-sm text-text-muted">
              Push: App auf dem Startbildschirm installieren (iPhone/iPad).
            </p>
          )}
          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {items.length === 0 && <li className="p-2 text-text-muted">Keine Benachrichtigungen.</li>}
            {items.map((n) => (
              <li key={n.id} className={`rounded-card p-2 ${n.readAt ? '' : 'bg-info-bg'}`}>
                {n.link ? (
                  <Link href={n.link} onClick={() => setOpen(false)} className="block">
                    <p className="font-semibold">{n.title}</p>
                    <p className="text-sm">{n.body}</p>
                  </Link>
                ) : (
                  <>
                    <p className="font-semibold">{n.title}</p>
                    <p className="text-sm">{n.body}</p>
                  </>
                )}
                <p className="text-xs text-text-muted">
                  {new Date(n.createdAt).toLocaleString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
