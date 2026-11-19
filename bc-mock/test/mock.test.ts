import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endpoints, entityPath, type EndpointName } from '@schroeder/bc-contract';
import { buildMockServer, SEED_COMPANY } from '../src/index.js';

const NOW = new Date('2026-11-16T08:00:00Z');
const { app, state } = buildMockServer({ now: NOW, pageSize: 25 });
const C = SEED_COMPANY.id;
const auth = { authorization: 'Bearer test' };
const path = (n: EndpointName) => `/api/${entityPath(n, C)}`;

beforeAll(async () => {
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe('seed data satisfies the BC contract', () => {
  for (const name of Object.keys(endpoints) as EndpointName[]) {
    it(name, () => {
      const schema = endpoints[name].schema;
      for (const row of state.tables[name]) {
        const r = schema.safeParse(row);
        if (!r.success) throw new Error(`${name}: ${JSON.stringify(row)} → ${r.error.message}`);
      }
    });
  }

  it('contains the expected agricultural brands and order types', () => {
    const brands = new Set(state.tables.serviceItems.map((s) => s.manufacturerCode));
    for (const b of ['FENDT', 'VALTRA', 'MF', 'AMAZONE', 'LEMKEN', 'CAT']) expect(brands).toContain(b);
    const types = new Set(state.tables.serviceOrders.map((s) => s.orderType));
    for (const t of ['KUNDE', 'WARTUNG']) expect(types).toContain(t);
    expect(state.tables.responsibilityCenters.length).toBeGreaterThanOrEqual(4);
  });
});

describe('BC API behaviour', () => {
  it('rejects requests without bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: path('items') });
    expect(res.statusCode).toBe(401);
  });

  it('pages with @odata.nextLink', async () => {
    const res = await app.inject({ method: 'GET', url: path('items'), headers: auth });
    const body = res.json();
    expect(body.value).toHaveLength(25);
    expect(decodeURIComponent(body['@odata.nextLink'])).toContain('$skiptoken=25');
    const next = await app.inject({ method: 'GET', url: body['@odata.nextLink'], headers: auth });
    expect(next.json().value.length).toBe(state.tables.items.length - 25);
  });

  it('filters by lastModifiedDateTime and string fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${path('serviceOrders')}?$filter=responsibilityCenter eq 'WILD' and lastModifiedDateTime gt 2000-01-01T00:00:00Z`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().value as Array<{ responsibilityCenter: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.responsibilityCenter === 'WILD')).toBe(true);
  });

  it('returns 400 for unknown filter properties', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${path('items')}?$filter=foo eq 'x'`,
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BadRequest_PropertyNotFound');
  });

  it('creates a service line idempotently via monteurAppId', async () => {
    const order = state.tables.serviceOrders.find((o) => o.status === 'Pending')!;
    const body = {
      documentNumber: order.number,
      serviceItemLineNumber: 10000,
      type: 'Item',
      number: 'X990.200.000',
      quantity: 12,
      unitOfMeasureCode: 'L',
      locationCode: 'WILD',
      monteurAppId: '5d1f0a8e-0c51-4a33-9a43-0d7c2f6c1a01',
    };
    const a = await app.inject({ method: 'POST', url: path('serviceLines'), headers: auth, payload: body });
    const b = await app.inject({ method: 'POST', url: path('serviceLines'), headers: auth, payload: body });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.json().id).toBe(a.json().id);
    expect(state.tables.serviceLines.filter((l) => l.monteurAppId === body.monteurAppId)).toHaveLength(1);
    expect(a.json().quantity).toBe(12);
    expect(a.json().lineNumber).toBe(10000);
  });

  it('requires If-Match for PATCH and detects concurrent changes', async () => {
    const order = state.tables.serviceOrders[0]!;
    const url = `${path('serviceOrders')}(${String(order.id)})`;
    const get = await app.inject({ method: 'GET', url, headers: auth });
    const etag = get.json()['@odata.etag'];
    const noMatch = await app.inject({
      method: 'PATCH',
      url,
      headers: auth,
      payload: { status: 'Finished' },
    });
    expect(noMatch.statusCode).toBe(428);
    const ok = await app.inject({
      method: 'PATCH',
      url,
      headers: { ...auth, 'if-match': etag },
      payload: { status: 'Finished' },
    });
    expect(ok.statusCode).toBe(200);
    const stale = await app.inject({
      method: 'PATCH',
      url,
      headers: { ...auth, 'if-match': etag },
      payload: { status: 'Pending' },
    });
    expect(stale.statusCode).toBe(412);
  });

  it('rejects writes to read-only entities', async () => {
    const res = await app.inject({ method: 'POST', url: path('items'), headers: auth, payload: {} });
    expect(res.statusCode).toBe(405);
  });

  it('supports JSON $batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/schroeder/werkstatt/v1.0/$batch',
      headers: auth,
      payload: {
        requests: [
          { id: '1', method: 'GET', url: `companies(${C})/serviceOrderTypes` },
          { id: '2', method: 'GET', url: `companies(${C})/workTypes` },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const r = res.json().responses;
    expect(r).toHaveLength(2);
    expect(r[0].status).toBe(200);
    expect(r[0].body.value.length).toBe(8);
  });

  it('injects failures (429 with Retry-After)', async () => {
    await app.inject({
      method: 'POST',
      url: '/__mock/failures',
      payload: { remaining: 1, status: 429, code: 'Application_TooManyRequests' },
    });
    const a = await app.inject({ method: 'GET', url: path('items'), headers: auth });
    expect(a.statusCode).toBe(429);
    expect(a.headers['retry-after']).toBe('1');
    const b = await app.inject({ method: 'GET', url: path('items'), headers: auth });
    expect(b.statusCode).toBe(200);
  });

  it('logs deletions for delta sync', async () => {
    const order = state.tables.serviceOrders.at(-1)!;
    await app.inject({
      method: 'POST',
      url: '/__mock/delete',
      payload: { entitySet: 'serviceOrders', id: order.id },
    });
    const res = await app.inject({ method: 'GET', url: path('deletedRecords'), headers: auth });
    expect(res.json().value.some((d: { recordSystemId: string }) => d.recordSystemId === order.id)).toBe(
      true,
    );
  });
});
