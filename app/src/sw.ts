/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

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
  precacheOptions: { cleanupOutdatedCaches: true, ignoreURLParametersMatching: [/^id$/, /^utm_/] },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: { entries: [{ url: '/offline', matcher: ({ request }) => request.destination === 'document' }] },
});

serwist.addEventListeners();
