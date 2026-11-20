/**
 * Phase 8: security hardening (OWASP ASVS L2 review, docs/SICHERHEIT.md). Every test belongs to a finding.
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLES } from '@schroeder/shared';
import { TokenVerifier } from '../src/auth/token-verifier.js';
import { BcClient, BcContractError } from '../src/bc/bc-client.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { assertDbRole } from '../src/db/role-check.js';
import { deliverPush, type PushSender } from '../src/modules/files/push.js';
import { DEV_SECRET } from './constants.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';

let app: NestExpressApplication;
let owner: pg.Client;
let workerDb: ReturnType<typeof createDb>;
const t = {} as Record<string, string>;
const ids = {} as Record<string, string>;
const as = (who: string) => ({ Authorization: `Bearer ${t[who]}` });
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const baseEnv = {
  APP_ENV: 'test',
  AUTH_MODE: 'dev',
  DEV_AUTH_SECRET: DEV_SECRET,
  DATABASE_URL: process.env.TEST_API_DATABASE_URL!,
};

beforeAll(async () => {
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  for (const p of ['monteur-wild', 'meister-wild', 'admin']) {
    t[p] = await tokenFor(app, p);
    ids[p] = (await q('select id from app_user where entra_oid = $1', [persona(p).oid]))[0].id;
  }
  ids.location = (await q("select id from location where code = 'WILD'"))[0].id;
});
afterAll(async () => {
  await workerDb.pool.end();
  await owner.end();
  await app.close();
});

describe('HTTP hardening (ASVS 14.4, 8.2.1)', () => {
  it('sets security headers and forbids caching of personal data', async () => {
    const res = await api(app).get('/v1/me').set(as('monteur-wild')).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=63072000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rate limits per user and answers 429 in German', async () => {
    const limited = await createApp(loadConfig({ ...baseEnv, RATE_LIMIT_PER_MIN: '5' }), { logger: false });
    await limited.init();
    try {
      const token = await limited
        .get(TokenVerifier)
        .issueDevToken({ ...persona('monteur-wild'), roles: [ROLES.Monteur] });
      const codes: number[] = [];
      for (let i = 0; i < 7; i++)
        codes.push(
          (await request(limited.getHttpServer()).get('/v1/me').set('Authorization', `Bearer ${token}`))
            .status,
        );
      expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
      const last = await request(limited.getHttpServer())
        .get('/v1/me')
        .set('Authorization', `Bearer ${token}`);
      expect(last.status).toBe(429);
      expect(last.body.message).toMatch(/Zu viele Anfragen/);
      // health checks are never limited
      expect((await request(limited.getHttpServer()).get('/health/live')).status).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('only accepts traffic through Front Door when configured (M3)', async () => {
    const fdid = randomUUID();
    const gated = await createApp(loadConfig({ ...baseEnv, FRONT_DOOR_ID: fdid }), { logger: false });
    await gated.init();
    try {
      const server = gated.getHttpServer();
      expect((await request(server).get('/v1/me').set(as('monteur-wild'))).status).toBe(403);
      expect(
        (await request(server).get('/v1/me').set(as('monteur-wild')).set('X-Azure-FDID', fdid)).status,
      ).toBe(200);
      expect((await request(server).get('/health/live')).status).toBe(200);
    } finally {
      await gated.close();
    }
  });

  it('speech upload is not buffered for anonymous requests (L7)', async () => {
    const res = await api(app)
      .post('/v1/speech/transcribe')
      .set('content-type', 'audio/webm')
      .send(Buffer.alloc(1000));
    expect(res.status).toBe(401);
  });
});

describe('configuration (M4)', () => {
  it('dev login is refused in every Azure deployment', () => {
    expect(() => loadConfig({ ...baseEnv, CONTAINER_APP_NAME: 'schr-monteur-test-api' })).toThrow(/Azure/);
  });
});

describe('database role split (H1)', () => {
  it('accepts the API role and refuses superuser / worker logins in strict mode', async () => {
    await expect(assertDbRole(process.env.TEST_API_DATABASE_URL!, 'api', true)).resolves.toBeUndefined();
    await expect(
      assertDbRole(process.env.TEST_WORKER_DATABASE_URL!, 'worker', true),
    ).resolves.toBeUndefined();
    await expect(assertDbRole(process.env.TEST_WORKER_DATABASE_URL!, 'api', true)).rejects.toThrow(
      /monteur_worker/,
    );
    await expect(assertDbRole(process.env.TEST_OWNER_DATABASE_URL!, 'api', true)).rejects.toThrow(
      /Superuser|BYPASSRLS/,
    );
    const warnings: string[] = [];
    await assertDbRole(process.env.TEST_OWNER_DATABASE_URL!, 'api', false, (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
  });
});

describe('Entra token checks (L1)', () => {
  it('accepts delegated user tokens of the known client only', async () => {
    const tenant = randomUUID();
    const audience = 'api://werkstatt-api-test';
    const client = randomUUID();
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    const v = new TokenVerifier(
      loadConfig({
        APP_ENV: 'test',
        AUTH_MODE: 'entra',
        DATABASE_URL: process.env.TEST_API_DATABASE_URL!,
        ENTRA_TENANT_ID: tenant,
        ENTRA_API_AUDIENCE: audience,
        ENTRA_ALLOWED_CLIENT_IDS: client,
      }),
    );
    (v as unknown as { jwks: unknown }).jwks = createLocalJWKSet({ keys: [jwk] });
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT({ oid: randomUUID(), tid: tenant, roles: ['Werkstatt.Monteur'], ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
    await expect(v.verify(await sign({ scp: 'access_as_user', azp: client }))).resolves.toMatchObject({
      roles: ['Werkstatt.Monteur'],
    });
    await expect(v.verify(await sign({ azp: client }))).rejects.toThrow(/scope/);
    await expect(v.verify(await sign({ scp: 'access_as_user', azp: randomUUID() }))).rejects.toThrow(
      /client/,
    );
    await expect(v.verify(await sign({ idtyp: 'app', scp: 'access_as_user', azp: client }))).rejects.toThrow(
      /app-only/,
    );
  });
});

describe('BC client (L4)', () => {
  it('never follows paging links to a foreign host with the bearer token', async () => {
    const seen: string[] = [];
    const bc = new BcClient({
      apiBaseUrl: 'https://api.businesscentral.dynamics.com/v2.0/tenant/sandbox/api',
      tokenUrl: 'https://login.example.invalid/token',
      clientId: 'x',
      clientSecret: 'y',
      scope: 'z',
      companyId: randomUUID(),
      maxRetries: 0,
      validate: false,
      fetchImpl: (async (url: string) => {
        seen.push(String(url));
        if (String(url).includes('/token'))
          return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
        return new Response(
          JSON.stringify({ value: [], '@odata.nextLink': 'https://evil.example.invalid/steal' }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    await expect(bc.list('items')).rejects.toBeInstanceOf(BcContractError);
    expect(seen.some((u) => u.includes('evil'))).toBe(false);
  });
});

describe('four-eyes principle (M5)', () => {
  let both: string;
  beforeAll(async () => {
    // meister-wild also works as Monteur at the same location
    await q(
      "insert into user_location (user_id, location_id, role) values ($1, $2, 'MONTEUR') on conflict do nothing",
      [ids['meister-wild'], ids.location],
    );
    both = await app
      .get(TokenVerifier)
      .issueDevToken({ ...persona('meister-wild'), roles: [ROLES.Meister, ROLES.Monteur] });
  });
  afterAll(async () => {
    await q("delete from user_location where user_id = $1 and role = 'MONTEUR'", [ids['meister-wild']]);
  });

  it('a Meister cannot approve own times', async () => {
    const res = await api(app)
      .post('/v1/approvals/time-days')
      .set('Authorization', `Bearer ${both}`)
      .send({ userId: ids['meister-wild'], workDate: '2026-11-16' })
      .expect(403);
    expect(res.body.message).toMatch(/Vier-Augen/);
  });

  it('a Meister cannot decide own vacation', async () => {
    const id = randomUUID();
    await q(
      "insert into absence (id, user_id, location_id, type, from_date, to_date, state) values ($1, $2, $3, 'URLAUB', '2027-08-02', '2027-08-06', 'REQUESTED')",
      [id, ids['meister-wild'], ids.location],
    );
    await api(app)
      .post(`/v1/absences/${id}/decision`)
      .set('Authorization', `Bearer ${both}`)
      .send({ decision: 'APPROVE' })
      .expect(403);
    expect((await q('select state from absence where id = $1', [id]))[0].state).toBe('REQUESTED');
  });
});

describe('photo uploads are checked on the server (M6)', () => {
  it('a non-JPEG blob is rejected and deleted', async () => {
    const [order] = await q(
      'select o.id from service_order o join assignment a on a.order_id = o.id where a.user_id = $1 and a.cancelled_at is null limit 1',
      [ids['monteur-wild']],
    );
    const photoId = randomUUID();
    await api(app)
      .post('/v1/sync/push')
      .set(as('monteur-wild'))
      .send({
        deviceId: 'phase8-device',
        deviceNow: new Date().toISOString(),
        commands: [
          {
            id: photoId,
            type: 'AttachPhoto',
            deviceTime: new Date().toISOString(),
            deviceSeq: 1,
            payload: {
              orderId: order.id,
              category: 'SONSTIGES',
              capturedAt: new Date().toISOString(),
              width: 10,
              height: 10,
              sizeBytes: 100,
            },
          },
        ],
      })
      .expect(200);
    const target = await api(app)
      .post(`/v1/photos/${photoId}/upload-target`)
      .set(as('monteur-wild'))
      .expect(200);
    const u = new URL(target.body.url).pathname;
    await api(app)
      .put(`${u}?comp=block&blockid=YmxvY2stMDAwMQ==`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('<html><script>alert(1)</script></html>'))
      .expect(201);
    await api(app)
      .put(`${u}?comp=blocklist`)
      .set('content-type', 'application/xml')
      .send('<?xml version="1.0"?><BlockList><Latest>YmxvY2stMDAwMQ==</Latest></BlockList>')
      .expect(201);
    const res = await api(app).post(`/v1/photos/${photoId}/complete`).set(as('monteur-wild')).expect(400);
    expect(res.body.message).toMatch(/kein gültiges Foto/);
    expect((await q('select upload_state from photo where id = $1', [photoId]))[0].upload_state).not.toBe(
      'UPLOADED',
    );
  });
});

describe('push on shared devices and lock screens (M1, M2)', () => {
  it('the newest subscription of a browser wins; absence texts never reach the lock screen', async () => {
    const endpoint = `https://push.example.invalid/${randomUUID()}`;
    const body = { endpoint, keys: { p256dh: 'BOr8kL8YvL8Q2xYz', auth: 'abcdefghijkl' } };
    await api(app).post('/v1/push/subscriptions').set(as('meister-wild')).send(body).expect(200);
    await new Promise((r) => setTimeout(r, 20));
    // same browser, next user signs in (previously: 500 because of the unique endpoint)
    await api(app).post('/v1/push/subscriptions').set(as('monteur-wild')).send(body).expect(200);
    await q(
      "insert into notification (user_id, kind, title, body) values ($1, 'SICK_REPORT', 'Krankmeldung', 'Max Muster: 20.11.2026'), ($2, 'CHAT', 'Nachricht', 'Hallo')",
      [ids['meister-wild'], ids['monteur-wild']],
    );
    const sent: Array<{ endpoint: string; payload: string }> = [];
    const sender: PushSender = {
      async send(sub, payload) {
        sent.push({ endpoint: sub.endpoint, payload });
        return { gone: false };
      },
    };
    await deliverPush(workerDb.db, sender);
    const mine = sent.filter((s) => s.endpoint === endpoint);
    // only the current user of the device gets pushes on it – the Meister's sick report does not appear there
    expect(mine.every((s) => !s.payload.includes('Krankmeldung'))).toBe(true);
    expect(mine.some((s) => s.payload.includes('Hallo'))).toBe(true);
    expect(
      (await q('select count(*)::int n from push_subscription where endpoint = $1', [endpoint]))[0].n,
    ).toBe(1);
    // and on other devices sick reports only show a neutral text
    const sick = sent.filter((s) => s.payload.includes('SICK_REPORT'));
    expect(sick.every((s) => !s.payload.includes('Max Muster'))).toBe(true);
  });
});

describe('Admin transfer view without health data (L5)', () => {
  it('redacts cause and description of absence transfers', async () => {
    await q(
      `insert into bc_transfer (location_id, bc_company_id, target, subject_type, subject_id, group_key, payload, state)
       select $1, l.bc_company_id, 'ABSENCE', 'absence', gen_random_uuid(), 'absence:x', $2::jsonb, 'FAILED' from location l where l.id = $1`,
      [
        ids.location,
        JSON.stringify({
          op: 'create',
          endpoint: 'employeeAbsences',
          body: { causeOfAbsenceCode: 'KRANK', description: 'Krank – Monteur-App', fromDate: '2026-11-20' },
        }),
      ],
    );
    const res = await api(app).get('/v1/admin/transfers?state=FAILED').set(as('admin')).expect(200);
    const row = res.body.find((r: { subjectType: string }) => r.subjectType === 'absence');
    expect(row.payload.body).toMatchObject({
      causeOfAbsenceCode: '***',
      description: '***',
      fromDate: '2026-11-20',
    });
    expect(JSON.stringify(res.body)).not.toContain('KRANK');
  });
});

describe('deletion periods for absences (DATENSCHUTZ.md, OP-18)', () => {
  it('deletes sick reports 12 months after their end; vacation keeps the period but loses the comment', async () => {
    const sick = randomUUID();
    const vac = randomUUID();
    const recent = randomUUID();
    await q(
      `insert into absence (id, user_id, location_id, type, from_date, to_date, state, comment) values
        ($1, $4, $5, 'KRANK', '2024-03-04', '2024-03-08', 'REPORTED', 'Telefonisch erreichbar'),
        ($2, $4, $5, 'URLAUB', '2024-07-01', '2024-07-05', 'APPROVED', 'Hochzeit'),
        ($3, $4, $5, 'KRANK', '2026-11-02', '2026-11-03', 'REPORTED', 'aktuell')`,
      [sick, vac, recent, ids['monteur-wild'], ids.location],
    );
    const { applyRetention } = await import('../src/jobs.js');
    const r = await applyRetention(workerDb.db, async () => undefined);
    expect(r.sickReports).toBeGreaterThanOrEqual(1);
    expect(await q('select 1 from absence where id = $1', [sick])).toHaveLength(0);
    expect(await q('select 1 from team_absence where absence_id = $1', [sick])).toHaveLength(0);
    expect((await q('select comment from absence where id = $1', [vac]))[0]).toEqual({ comment: null });
    expect((await q('select comment from absence where id = $1', [recent]))[0]).toEqual({
      comment: 'aktuell',
    });
  });
});

describe('"Aus BC aktualisieren" (E-61)', () => {
  it('queues a refresh for a visible order once; foreign orders stay invisible', async () => {
    const [mine] = await q(
      'select o.id from service_order o join assignment a on a.order_id = o.id where a.user_id = $1 and a.cancelled_at is null limit 1',
      [ids['monteur-wild']],
    );
    const first = await api(app).post(`/v1/orders/${mine.id}/refresh`).set(as('monteur-wild')).expect(202);
    expect(first.body.alreadyRequested).toBe(false);
    const again = await api(app).post(`/v1/orders/${mine.id}/refresh`).set(as('monteur-wild')).expect(202);
    expect(again.body.alreadyRequested).toBe(true);
    const [foreign] = await q(
      'select id from service_order where location_id <> $1 and id not in (select order_id from assignment where user_id = $2) limit 1',
      [ids.location, ids['monteur-wild']],
    );
    await api(app).post(`/v1/orders/${foreign.id}/refresh`).set(as('monteur-wild')).expect(404);
  });
});
