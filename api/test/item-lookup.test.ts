/** Item lookup without an order (E-71): stock per storage, other locations, substitute / successor items. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildMockServer } from '@schroeder/bc-mock';
import { BcClient } from '../src/bc/bc-client.js';
import { BcSyncService } from '../src/bc/bc-sync.service.js';
import { createDb } from '../src/db/client.js';
import { TEST_NOW } from './constants.js';
import { api, createTestApp, tokenFor } from './helpers.js';

const { app: mock } = buildMockServer({ now: TEST_NOW, pageSize: 50 });
let app: NestExpressApplication;
let workerDb: ReturnType<typeof createDb>;
let token: string;

beforeAll(async () => {
  const base = await mock.listen({ port: 0, host: '127.0.0.1' });
  app = await createTestApp();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  await new BcSyncService(
    workerDb.db,
    (companyId) =>
      new BcClient({
        apiBaseUrl: `${base}/api`,
        tokenUrl: `${base}/oauth2/token`,
        clientId: 'x',
        clientSecret: 'y',
        scope: 'z',
        companyId,
        backoffBaseMs: 1,
      }),
  ).runAll();
  token = await tokenFor(app, 'monteur-wild');
});
afterAll(async () => {
  await workerDb.pool.end();
  await app.close();
  await mock.close();
});

const search = async (code: string) =>
  (
    await api(app)
      .get(`/v1/items/search?code=${encodeURIComponent(code)}`)
      .set({ Authorization: `Bearer ${token}` })
  ).body as Array<{ number: string; substitutes: Array<{ number: string; relation: string }> }>;

it('shows the successor of an old item and the predecessor of the new one', async () => {
  const [old] = await search('F931.200.020.110');
  expect(old!.substitutes).toEqual([
    expect.objectContaining({ number: 'F931.200.020.010', relation: 'NACHFOLGER' }),
  ]);
  const [neu] = await search('F931.200.020.010');
  expect(neu!.substitutes).toEqual([
    expect.objectContaining({ number: 'F931.200.020.110', relation: 'VORGAENGER' }),
  ]);
});

it('interchangeable items are substitutes both ways', async () => {
  const [a] = await search('H931.202.050.020');
  expect(a!.substitutes).toEqual([
    expect.objectContaining({ number: 'H931.202.050.010', relation: 'ERSATZ' }),
  ]);
});
