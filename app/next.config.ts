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

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  transpilePackages: ['@schroeder/shared', '@schroeder/ui'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default withSerwist(config);
