'use client';

import { Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const KEY = 'installHintDismissed';

/** iPadOS 13+ reports itself as "Macintosh"; touch points tell it apart from a Mac. */
function isIosSafariTab(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}

/**
 * iPad/iPhone in a normal Safari tab: Safari deletes offline data after 7 days without use and allows push only
 * for Home Screen apps – so we ask to add the app to the Home Screen (docs/IPAD.md).
 */
export function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY)) return;
    } catch {
      /* storage blocked: show anyway */
    }
    setShow(isIosSafariTab());
  }, []);
  if (!show) return null;
  return (
    <div
      className="flex items-start gap-3 border-b border-warning bg-warning-bg px-4 py-3 text-warning"
      role="note"
    >
      <Share aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="flex-1 text-sm font-semibold">
        Bitte die App zum Home-Bildschirm hinzufügen: oben auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.
        Nur so bleiben Offline-Daten erhalten und Benachrichtigungen funktionieren.
      </p>
      <button
        type="button"
        className="min-h-touch min-w-touch shrink-0"
        aria-label="Hinweis ausblenden"
        onClick={() => {
          try {
            sessionStorage.setItem(KEY, '1');
          } catch {
            /* ignore */
          }
          setShow(false);
        }}
      >
        <X aria-hidden className="mx-auto h-5 w-5" />
      </button>
    </div>
  );
}
