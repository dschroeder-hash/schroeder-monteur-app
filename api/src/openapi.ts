import { writeFileSync } from 'node:fs';
import { buildOpenApi, createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

/** Writes openapi.json without starting the server (used in CI and by the app's API client generation). */
const config = loadConfig({
  ...process.env,
  AUTH_MODE: 'dev',
  DEV_AUTH_SECRET: 'x'.repeat(32),
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/none',
});
const app = await createApp(config, { logger: false });
writeFileSync(process.argv[2] ?? 'openapi.json', JSON.stringify(buildOpenApi(app), null, 2));
await app.close();
