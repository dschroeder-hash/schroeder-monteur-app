/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

/**
 * App shell is precached; API data is NOT cached by the service worker – offline data lives in IndexedDB
 * (Dexie) and is written through the outbox, so the SW never serves stale personal data.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // /monteur/auftrag?id=… must hit the precached page offline; RSC requests (_rsc) are deliberately not matched,
  // so Next falls back to a full navigation that the precache can answer.
  precacheOptions: {
    cleanupOutdatedCaches: true,
    ignoreURLParametersMatching: [/^id$/, /^orderId$/, /^utm_/],
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Never cache cross-origin responses: the API (authenticated, personal data) and photo URLs live on other
  // origins; Serwist's default list would keep them for an hour regardless of the signed-in user.
  runtimeCaching: [{ matcher: ({ sameOrigin }) => !sameOrigin, handler: new NetworkOnly() }, ...defaultCache],
  fallbacks: { entries: [{ url: '/offline', matcher: ({ request }) => request.destination === 'document' }] },
});

serwist.addEventListeners();

// Web Push (PROMPT 5.2/5.8): show the notification; a tap opens or focuses the app at the link.
self.addEventListener('push', (event) => {
  const data = (() => {
    try {
      return event.data?.json() as { title?: string; body?: string; link?: string; tag?: string };
    } catch {
      return { title: 'Schröder Werkstatt', body: event.data?.text() };
    }
  })();
  event.waitUntil(
    self.registration.showNotification(data?.title ?? 'Schröder Werkstatt', {
      body: data?.body ?? '',
      tag: data?.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { link: data?.link ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data as { link?: string } | undefined)?.link ?? '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = all.find((c) => 'focus' in c);
      if (existing) {
        await (existing as WindowClient).navigate(link);
        return (existing as WindowClient).focus();
      }
      return self.clients.openWindow(link);
    })(),
  );
});
