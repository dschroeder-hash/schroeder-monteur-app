import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { DEV_PERSONAS } from '../src/seed/personas.js';
import { DEV_SECRET } from './constants.js';

export type PersonaKey = (typeof DEV_PERSONAS)[number]['key'];

export async function createTestApp(): Promise<NestExpressApplication> {
  const config = loadConfig({
    APP_ENV: 'test',
    AUTH_MODE: 'dev',
    DEV_AUTH_SECRET: DEV_SECRET,
    DATABASE_URL: process.env.TEST_API_DATABASE_URL!,
  });
  const app = await createApp(config, { logger: false });
  await app.init();
  return app;
}

export async function tokenFor(app: NestExpressApplication, key: PersonaKey | string): Promise<string> {
  const p = DEV_PERSONAS.find((x) => x.key === key);
  if (!p) throw new Error(`unknown persona ${key}`);
  return app.get(TokenVerifier).issueDevToken({ oid: p.oid, name: p.name, email: p.email, roles: p.roles });
}

export function api(app: NestExpressApplication) {
  return request(app.getHttpServer());
}

export const persona = (key: string) => DEV_PERSONAS.find((p) => p.key === key)!;
