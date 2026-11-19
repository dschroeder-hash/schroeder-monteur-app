'use client';

import { useEffect } from 'react';

/**
 * Next.js client navigation fetches the page data (RSC) from the server. Offline that request fails and the
 * page would not change. While offline we therefore turn internal link clicks into full page loads, which the
 * service worker answers from its precache (ARCHITEKTUR 4.2).
 */
export function OfflineNavigation() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        navigator.onLine ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.pathname + url.search + url.hash);
    };
    // Capture phase on document: runs before React's delegated Link handler.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}

/** Programmatic navigation that also works offline. */
export function navigate(router: { push: (href: string) => void }, href: string) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) window.location.assign(href);
  else router.push(href);
}
