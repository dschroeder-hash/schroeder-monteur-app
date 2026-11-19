/** Contract tests: the connector against the BC mock; both validate against @schroeder/bc-contract. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { endpoints, type EndpointName } from '@schroeder/bc-contract';
import { buildMockServer, SEED_COMPANY } from '@schroeder/bc-mock';
import { BcClient, BcError, normalizeBcRecord } from '../src/bc/bc-client.js';

const { app: mock, state } = buildMockServer({ now: new Date('2026-11-16T06:00:00Z'), pageSize: 20 });
let client: BcClient;
let base: string;

beforeAll(async () => {
  base = await mock.listen({ port: 0, host: '127.0.0.1' });
  client = new BcClient({
    apiBaseUrl: `${base}/api`,
    tokenUrl: `${base}/oauth2/token`,
    clientId: 'x',
    clientSecret: 'y',
    scope: 'z',
    companyId: SEED_COMPANY.id,
    backoffBaseMs: 5,
  });
});
afterAll(async () => {
  await mock.close();
});

describe('read endpoints', () => {
  for (const name of Object.keys(endpoints) as EndpointName[]) {
    it(`${name}: all pages parse against the contract`, async () => {
      const rows = await client.list(name);
      expect(rows.length).toBe(state.tables[name].length);
    });
  }

  it('delta query returns only records modified after the cursor', async () => {
    const before = new Date();
    const order = state.tables.serviceOrders[3]!;
    await fetch(`${base}/__mock/change`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entitySet: 'serviceOrders',
        id: order.id,
        patch: { description: 'Geändert in BC' },
      }),
    });
    const changed = await client.listModifiedSince('serviceOrders', before, 0);
    expect(changed.map((o) => o.id)).toEqual([order.id]);
    expect(changed[0]!.description).toBe('Geändert in BC');
  });
});

describe('write endpoints', () => {
  it('creates a resource line idempotently (replay returns the same record)', async () => {
    const order = state.tables.serviceOrders.find((o) => o.status === 'Pending')!;
    const payload = {
      documentNumber: order.number,
      serviceItemLineNumber: 10000,
      type: 'Resource',
      number: 'R0001',
      quantity: 1.25,
      unitOfMeasureCode: 'STUNDE',
      locationCode: '',
      workTypeCode: 'ARBEIT',
      monteurAppId: '0d0c4f70-2c5e-4b8e-9d64-6b2c1b0e7a11',
    };
    const a = await client.create('serviceLines', payload);
    const b = await client.create('serviceLines', payload);
    expect(b.record.id).toBe(a.record.id);
    expect(a.record.quantity).toBe(1.25);
  });

  it('retries on 429 and 503', async () => {
    for (const status of [429, 503])
      await fetch(`${base}/__mock/failures`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remaining: 2, status, code: 'Transient' }),
      });
    const rows = await client.list('workTypes');
    expect(rows).toHaveLength(3);
  });

  it('surfaces business errors as non-retryable', async () => {
    const finished = state.tables.serviceOrders.find((o) => o.status === 'Finished')!;
    const err = await client
      .create('serviceLines', {
        documentNumber: finished.number,
        serviceItemLineNumber: 10000,
        type: 'Item',
        number: 'X990.200.000',
        quantity: 1,
        unitOfMeasureCode: 'L',
        locationCode: 'WILD',
        monteurAppId: '0d0c4f70-2c5e-4b8e-9d64-6b2c1b0e7a12',
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BcError);
    expect(err.status).toBe(400);
    expect(err.retryable).toBe(false);
  });

  it('PATCH uses optimistic concurrency (412 on stale ETag)', async () => {
    const order = state.tables.serviceOrders.find((o) => o.status === 'Pending')!;
    const { etag } = await client.get('serviceOrders', String(order.id));
    await client.patch('serviceOrders', String(order.id), etag!, { status: 'In Process' });
    const err = await client
      .patch('serviceOrders', String(order.id), etag!, { status: 'Finished' })
      .catch((e) => e);
    expect(err.status).toBe(412);
  });
});

describe('normalisation of BC blank values', () => {
  it('maps 0001-01-01 to null and strips OData annotations', () => {
    expect(normalizeBcRecord({ responseDate: '0001-01-01', x: '_x0020_', '@odata.etag': 'W/"1"' })).toEqual({
      responseDate: null,
      x: ' ',
    });
  });
});
