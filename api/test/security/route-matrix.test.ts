/**
 * Proves server-side access control for EVERY route (PROMPT section 4: "durch Tests gegen die API belegt").
 * The route inventory is read from the OpenAPI document; a new route without an entry here fails the build.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApi } from '../../src/bootstrap.js';
import { api, createTestApp, tokenFor } from '../helpers.js';

type Persona = 'monteur-wild' | 'meister-wild' | 'lager-wild' | 'personal' | 'admin' | 'werkstatt-pc-wild';
const ALL: Persona[] = [
  'monteur-wild',
  'meister-wild',
  'lager-wild',
  'personal',
  'admin',
  'werkstatt-pc-wild',
];

/** Expected access per route. `allowed` personas must NOT get 401/403; all others MUST get 403. */
const MATRIX: Record<string, { public?: boolean; allowed?: Persona[]; sample?: string; body?: unknown }> = {
  'GET /health/live': { public: true },
  'GET /health/ready': { public: true },
  'GET /v1/me': { allowed: ALL },
  'GET /v1/me/export': { allowed: ALL },
  'GET /v1/orders': { allowed: ['monteur-wild', 'meister-wild', 'lager-wild'] },
  'POST /v1/orders/{id}/refresh': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'GET /v1/orders/{id}': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'GET /v1/admin/locations': { allowed: ['admin'] },
  'POST /v1/admin/locations': { allowed: ['admin'], body: {} },
  'PATCH /v1/admin/locations/{id}': {
    allowed: ['admin'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'GET /v1/admin/users': { allowed: ['admin'] },
  'PUT /v1/admin/users/{id}/grants': {
    allowed: ['admin'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'PUT /v1/admin/users/{id}/bc-mapping': {
    allowed: ['admin'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'GET /v1/admin/features': { allowed: ['admin'] },
  'PUT /v1/admin/features': { allowed: ['admin'], body: {} },
  'GET /v1/admin/checklist-templates': { allowed: ['admin'] },
  'PUT /v1/admin/users/{id}/pin': { allowed: ['admin'], body: {} },
  'PUT /v1/me/pin': { allowed: ['monteur-wild'], body: {} },
  'POST /v1/terminal/identify': { allowed: ['werkstatt-pc-wild'], body: {} },
  'POST /v1/terminal/stamp': { allowed: ['werkstatt-pc-wild'], body: {} },
  'POST /v1/admin/checklist-templates': { allowed: ['admin'], body: {} },
  'PUT /v1/admin/checklist-templates/{id}': { allowed: ['admin'], body: {} },
  'POST /v1/sync/push': { allowed: ['monteur-wild'], body: {} },
  'GET /v1/sync/pull': { allowed: ['monteur-wild'] },
  'GET /v1/planning/board': { allowed: ['meister-wild'] },
  'POST /v1/planning/assignments': { allowed: ['meister-wild'], body: {} },
  'PATCH /v1/planning/assignments/{id}': {
    allowed: ['meister-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'DELETE /v1/planning/assignments/{id}': {
    allowed: ['meister-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'GET /v1/approvals/inbox': { allowed: ['meister-wild'] },
  'GET /v1/productivity/me': { allowed: ['monteur-wild'] },
  'GET /v1/productivity/team': { allowed: ['meister-wild'] },
  'GET /v1/admin/productivity': { allowed: ['admin'] },
  'POST /v1/admin/productivity/mapping': { allowed: ['admin'], body: {} },
  'PUT /v1/admin/productivity/config': { allowed: ['admin'], body: {} },
  'GET /v1/absences/team': { allowed: ['monteur-wild', 'meister-wild'] },
  'GET /v1/absences': { allowed: ['meister-wild', 'personal'] },
  'POST /v1/absences/sick': { allowed: ['meister-wild', 'personal'], body: {} },
  'POST /v1/absences/{id}/end': {
    allowed: ['meister-wild', 'personal'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'POST /v1/absences/{id}/acknowledge': {
    allowed: ['meister-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'POST /v1/absences/{id}/decision': {
    allowed: ['meister-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'GET /v1/absences/balances': { allowed: ['meister-wild', 'personal'] },
  'PUT /v1/absences/balances': { allowed: ['personal'], body: {} },
  'GET /v1/approvals/day-events': { allowed: ['meister-wild'] },
  'POST /v1/approvals/time-days': { allowed: ['meister-wild'], body: {} },
  'POST /v1/approvals/time-corrections': { allowed: ['meister-wild'], body: {} },
  'POST /v1/approvals/correction-requests/{id}': {
    allowed: ['meister-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'POST /v1/orders/{id}/status': {
    allowed: ['meister-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'GET /v1/admin/transfers': { allowed: ['admin'] },
  'POST /v1/approvals/consumptions': { allowed: ['meister-wild'], body: {} },
  'POST /v1/approvals/consumptions/{id}/reject': {
    allowed: ['meister-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'GET /v1/items/search': { allowed: ['monteur-wild', 'meister-wild', 'lager-wild', 'werkstatt-pc-wild'] },
  'GET /v1/items/resolve': { allowed: ['monteur-wild', 'meister-wild', 'lager-wild'] },
  'GET /v1/parts/catalogs': { allowed: ['monteur-wild', 'meister-wild', 'lager-wild'] },
  'POST /v1/parts/cart-from-image': { allowed: ['monteur-wild', 'meister-wild', 'lager-wild'] },
  'GET /v1/parts/shop-cart/inbox': { allowed: ['monteur-wild', 'meister-wild', 'lager-wild'] },
  'POST /v1/parts/catalog-sessions': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    body: { catalogId: 'agco', orderId: null },
  },
  // Catalog hand-back (E-80): no sign-in, the session secret in the address identifies Monteur and order.
  'POST /v1/parts/catalog-return/{token}': { public: true },
  'GET /v1/parts/catalog-return/{token}': { public: true },
  'GET /v1/parts/requests': { allowed: ['meister-wild', 'lager-wild'] },
  'POST /v1/parts/requests/{id}/state': {
    allowed: ['meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'GET /v1/stock/warnings': { allowed: ['meister-wild', 'lager-wild'] },
  'GET /v1/admin/containers': { allowed: ['admin'] },
  'POST /v1/photos/{id}/upload-target': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'POST /v1/photos/{id}/complete': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'GET /v1/orders/{id}/photos': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'GET /v1/photos/{id}/url': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'GET /v1/orders/{id}/chat': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'POST /v1/orders/{id}/chat': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'POST /v1/orders/{id}/chat/read': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'GET /v1/orders/{id}/report': {
    allowed: ['monteur-wild', 'meister-wild', 'lager-wild'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'GET /v1/notifications': { allowed: ALL },
  'POST /v1/notifications/read': {
    allowed: ALL,
    body: {},
  },
  'GET /v1/push/vapid-public-key': { public: true },
  'POST /v1/push/subscriptions': {
    allowed: ALL,
    body: {},
  },
  'DELETE /v1/push/subscriptions': {
    allowed: ALL,
    body: {},
  },
  'GET /v1/realtime/negotiate': {
    allowed: ALL,
  },
  'POST /v1/speech/transcribe': { allowed: ['monteur-wild', 'meister-wild'] },
  'POST /v1/speech/rewrite': { allowed: ['monteur-wild', 'meister-wild'], body: {} },
  'GET /v1/templates': { allowed: ['meister-wild', 'admin'] },
  'POST /v1/templates': { allowed: ['meister-wild', 'admin'], body: {} },
  'PATCH /v1/templates/{id}': {
    allowed: ['meister-wild', 'admin'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'POST /v1/admin/containers': { allowed: ['admin'], body: {} },
  'PATCH /v1/admin/containers/{id}': {
    allowed: ['admin'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
  'POST /v1/admin/transfers/{id}/retry': {
    allowed: ['admin'],
    sample: '00000000-0000-4000-8000-00000000dead',
  },
  'POST /v1/admin/transfers/{id}/resolve': {
    allowed: ['admin'],
    sample: '00000000-0000-4000-8000-00000000dead',
    body: {},
  },
};

let app: NestExpressApplication;
let routes: Array<{ key: string; method: string; path: string }>;
const tokens = {} as Record<Persona, string>;

beforeAll(async () => {
  app = await createTestApp();
  const doc = buildOpenApi(app);
  routes = Object.entries(doc.paths).flatMap(([path, ops]) =>
    Object.keys(ops as object)
      .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
      .map((m) => ({ key: `${m.toUpperCase()} ${path}`, method: m, path })),
  );
  for (const p of ALL) tokens[p] = await tokenFor(app, p);
});
afterAll(async () => {
  await app.close();
});

const url = (path: string, sample?: string) =>
  path.replace(/\{[^}]+\}/g, sample ?? '00000000-0000-4000-8000-000000000000');
const call = (method: string, u: string, token?: string, body?: unknown) => {
  const r = (api(app) as unknown as Record<string, (u: string) => import('supertest').Test>)[method]!(u);
  if (token) r.set('Authorization', `Bearer ${token}`);
  return body !== undefined ? r.send(body as object) : r;
};

describe('route inventory', () => {
  it('every route is covered by the access matrix', () => {
    const missing = routes.map((r) => r.key).filter((k) => !MATRIX[k]);
    expect(missing, 'add new routes to MATRIX in route-matrix.test.ts').toEqual([]);
  });
  it('matrix has no stale entries', () => {
    const stale = Object.keys(MATRIX).filter((k) => !routes.some((r) => r.key === k));
    expect(stale).toEqual([]);
  });
});

describe('authentication is required (deny by default)', () => {
  it.each(Object.entries(MATRIX).filter(([, v]) => !v.public))(
    '%s → 401 without / with forged token',
    async (key, v) => {
      const [method, path] = key.split(' ') as [string, string];
      const u = url(path, v.sample);
      expect((await call(method.toLowerCase(), u, undefined, v.body)).status).toBe(401);
      expect(
        (await call(method.toLowerCase(), u, 'eyJhbGciOiJub25lIn0.eyJvaWQiOiJ4In0.', v.body)).status,
      ).toBe(401);
    },
  );
});

describe('role matrix', () => {
  for (const [key, v] of Object.entries(MATRIX).filter(([, x]) => !x.public)) {
    for (const p of ALL) {
      const allowed = v.allowed?.includes(p);
      it(`${key} as ${p} → ${allowed ? 'allowed' : '403'}`, async () => {
        const [method, path] = key.split(' ') as [string, string];
        const res = await call(method.toLowerCase(), url(path, v.sample), tokens[p], v.body);
        if (allowed) expect([401, 403]).not.toContain(res.status);
        else expect(res.status).toBe(403);
      });
    }
  }
});
