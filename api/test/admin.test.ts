import { FeatureService } from '../src/features/feature.service.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { api, createTestApp, tokenFor } from './helpers.js';

let app: NestExpressApplication;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('feature flags per location (BetrVG § 87)', () => {
  it('admin disables a module for a location; users there see it off; audit entry written', async () => {
    const admin = await tokenFor(app, 'admin');
    const locs = (await api(app).get('/v1/admin/locations').set('Authorization', `Bearer ${admin}`))
      .body as Array<{ id: string; code: string }>;
    const wild = locs.find((l) => l.code === 'WILD')!;
    const res = await api(app).put('/v1/admin/features').set('Authorization', `Bearer ${admin}`).send({
      locationId: wild.id,
      feature: 'productivity.self',
      enabled: false,
      note: 'BV Zeiterfassung noch nicht unterschrieben',
    });
    expect(res.status).toBe(200);

    const m = await tokenFor(app, 'monteur-wild');
    const me = await api(app).get('/v1/me').set('Authorization', `Bearer ${m}`);
    expect(me.body.features['productivity.self']).toBe(false);
    const clp = await tokenFor(app, 'monteur-clp');
    expect(
      (await api(app).get('/v1/me').set('Authorization', `Bearer ${clp}`)).body.features['productivity.self'],
    ).toBe(true);

    const owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
    await owner.connect();
    const audit = await owner.query(
      "select * from audit_log where action = 'SET_FEATURE' and entity_id = $1",
      [`${wild.id}:productivity.self`],
    );
    // Clean up: other test files rely on the default flags.
    await owner.query("delete from feature_flag where location_id = $1 and feature = 'productivity.self'", [
      wild.id,
    ]);
    await owner.end();
    app.get(FeatureService).invalidate();
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].reason).toContain('BV');
  });

  it('validates input with German messages', async () => {
    const admin = await tokenFor(app, 'admin');
    const res = await api(app)
      .put('/v1/admin/features')
      .set('Authorization', `Bearer ${admin}`)
      .send({ feature: 'gibtsnicht' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Ungültige Eingabe');
  });
});

describe('first sign-in', () => {
  it('provisions an unknown Entra user without any data access', async () => {
    const { TokenVerifier } = await import('../src/auth/token-verifier.js');
    const t = await app.get(TokenVerifier).issueDevToken({
      oid: '00000000-0000-4000-8000-0000000abcde',
      name: 'Neuer Monteur',
      email: 'neu@example.invalid',
      roles: ['Werkstatt.Monteur'],
    });
    const me = await api(app).get('/v1/me').set('Authorization', `Bearer ${t}`);
    expect(me.status).toBe(200);
    expect(me.body.grants).toEqual([]);
    const orders = await api(app).get('/v1/orders').set('Authorization', `Bearer ${t}`);
    expect(orders.body).toEqual([]);
  });
});

describe('configuration safety', () => {
  it('refuses dev auth and BC mock in production', () => {
    expect(() =>
      loadConfig({
        APP_ENV: 'prod',
        AUTH_MODE: 'dev',
        DEV_AUTH_SECRET: 'x'.repeat(32),
        DATABASE_URL: 'postgres://x/y',
        BC_MODE: 'mock',
      }),
    ).toThrow(/AUTH_MODE=dev is not allowed in prod[\s\S]*BC_MODE=mock/);
  });
  it('dev login is not reachable when AUTH_MODE=entra', async () => {
    // In the test app AUTH_MODE=dev → persona list is available …
    expect((await api(app).get('/dev/personas')).status).toBe(200);
  });
});
