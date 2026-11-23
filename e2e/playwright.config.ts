import { defineConfig, devices } from '@playwright/test';

const admin = process.env.E2E_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const host = new URL(admin).host;
export const E2E_DB = 'monteur_e2e';
export const API_URL = 'http://localhost:4010';
export const BC_MOCK_URL = 'http://localhost:4110';

/**
 * Start of the working day lived by offline-day.spec.ts: 06:00 UTC (07:00/08:00 in Germany) of today, or of
 * yesterday if that is less than 9 h ago – the day is fast-forwarded and must neither cross midnight nor reach
 * into the future (the server rejects future stamps). Used by the global setup (seed day) and the spec.
 */
export function deviceDayStart(now = Date.now()): Date {
  const today = new Date(now);
  today.setUTCHours(6, 0, 0, 0);
  return now - today.getTime() >= 9 * 3_600_000 ? today : new Date(today.getTime() - 86_400_000);
}

const engine = process.env.E2E_ENGINE === 'chromium' ? { browserName: 'chromium' as const } : {};

/**
 * End-to-end tests against the production build of the app (service worker active) and the real API.
 * Requires: `pnpm --filter @schroeder/e2e build:app` and `pnpm --filter @schroeder/api build` beforehand.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3010',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'allow',
    screenshot: 'only-on-failure',
  },
  // Main device is the iPad (Safari engine WebKit, as every browser on iPadOS), phone as second device.
  // Each project needs a fresh database (the specs change the seed data): run one project per invocation,
  // e.g. `pnpm test:e2e --project=ipad-quer`. E2E_ENGINE=chromium runs the iPad projects without WebKit.
  projects: [
    { name: 'smartphone', use: { ...devices['Pixel 7'] } },
    { name: 'ipad-quer', use: { ...devices['iPad Pro 11 landscape'], ...engine } },
    { name: 'ipad-hoch', use: { ...devices['iPad Pro 11'], ...engine } },
  ],
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: `${API_URL}/health/live`,
      reuseExistingServer: false,
      env: {
        APP_ENV: 'test',
        PORT: '4010',
        CART_AI: 'mock',
        AUTH_MODE: 'dev',
        DEV_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234',
        DATABASE_URL: `postgres://monteur_api_e2e:e2e@${host}/${E2E_DB}`,
        CORS_ORIGINS: 'http://localhost:3010',
        PUBLIC_API_URL: API_URL,
        LOCAL_STORAGE_DIR: '/tmp/monteur-e2e-uploads',
      },
    },
    {
      command: 'node ../bc-mock/dist/main.js',
      url: `${BC_MOCK_URL}/health`,
      reuseExistingServer: false,
      env: { PORT: '4110' },
    },
    {
      // Worker: BC delta sync + transfer queue against the mock (fast intervals for the test).
      command: 'node ../api/dist/worker.js',
      url: 'http://localhost:4012/health/live',
      reuseExistingServer: false,
      env: {
        APP_ENV: 'test',
        BC_MODE: 'mock',
        BC_API_BASE_URL: `${BC_MOCK_URL}/api`,
        BC_TOKEN_URL: `${BC_MOCK_URL}/oauth2/token`,
        BC_SYNC_INTERVAL_SEC: '600',
        AUTO_APPROVE_INTERVAL_SEC: '3',
        WORKER_HEALTH_PORT: '4012',
        DATABASE_URL: `postgres://monteur_worker_e2e:e2e@${host}/${E2E_DB}`,
      },
    },
    {
      command: 'node .next/standalone/app/server.js',
      cwd: '../app',
      env: { PORT: '3010', HOSTNAME: '127.0.0.1' },
      url: 'http://localhost:3010/login',
      reuseExistingServer: false,
    },
  ],
});
