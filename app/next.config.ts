import { randomUUID } from 'node:crypto';
import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

// App shell pages are precached so the Monteur can open them offline even if never visited (ARCHITEKTUR 4.2).
const revision = process.env.GIT_SHA ?? randomUUID();
const OFFLINE_PAGES = [
  '/',
  '/login',
  '/offline',
  '/monteur',
  '/monteur/auftrag',
  '/monteur/kalender',
  '/monteur/zeiten',
  '/monteur/material',
  '/monteur/verbrauch',
  '/monteur/bericht',
  '/monteur/chat',
  '/monteur/abwesenheit',
  '/chat',
  // Header images must not break offline.
  '/icons/icon-192.png',
  '/brand/logo.svg',
  // Barcode reader – scanning must work offline (E-18).
  '/zxing/zxing_reader.wasm',
];

const withSerwist = withSerwistInit({
  additionalPrecacheEntries: OFFLINE_PAGES.map((url) => ({ url, revision })),
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  // Service worker only in production builds; dev uses network.
  disable: process.env.NODE_ENV === 'development',
  cacheOnNavigation: true,
  reloadOnOnline: false,
});

// Content Security Policy (ASVS 14.4.3). Inline scripts stay allowed: the theme bootstrap and Next's flight data are
// inline and the app shell is static/precached (no per-request nonce). The value lies in the strict lists of where
// the app may connect to, load from and be framed by. 'wasm-unsafe-eval' is needed by the barcode reader (zxing).
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? '').origin;
  } catch {
    return '';
  }
})();
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://*.blob.core.windows.net ${apiOrigin}`,
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin} https://login.microsoftonline.com https://*.blob.core.windows.net wss://*.webpubsub.azure.com https://*.webpubsub.azure.com`,
  'frame-src https://login.microsoftonline.com',
  "media-src 'self' blob: mediastream:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  productionBrowserSourceMaps: process.env.DEBUG_SOURCEMAPS === '1',
  poweredByHeader: false,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  transpilePackages: ['@schroeder/shared', '@schroeder/ui'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withSerwist(config);
