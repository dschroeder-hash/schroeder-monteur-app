/** Remarks (customer, machine, order) and contact persons from BC, read only for the Monteur's own orders. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildMockServer } from '@schroeder/bc-mock';
import { BcClient } from '../src/bc/bc-client.js';
import { BcSyncService } from '../src/bc/bc-sync.service.js';
import { createDb } from '../src/db/client.js';
import { TEST_NOW } from './constants.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';

const { app: mock, state } = buildMockServer({ now: TEST_NOW, pageSize: 50 });
let app: NestExpressApplication;
let owner: pg.Client;
let workerDb: ReturnType<typeof createDb>;
let sync: BcSyncService;

beforeAll(async () => {
  const base = await mock.listen({ port: 0, host: '127.0.0.1' });
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  sync = new BcSyncService(
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
  );
});
afterAll(async () => {
  await workerDb.pool.end();
  await owner.end();
  await app.close();
  await mock.close();
});

it('the BC sync stores customer and machine remarks and contact persons', async () => {
  await sync.runAll();
  const n = async (scope: string) =>
    (await owner.query('select count(*)::int as n from bc_remark where scope = $1', [scope])).rows[0].n;
  expect(await n('CUSTOMER')).toBe(state.tables.customerComments.length);
  expect(await n('SERVICE_ITEM')).toBe(state.tables.serviceItemComments.length);
  expect((await owner.query('select count(*)::int as n from bc_contact')).rows[0].n).toBe(
    state.tables.customerContacts.length,
  );
});

it("the Monteur gets remarks and contacts of his orders' customers only", async () => {
  const token = await tokenFor(app, 'monteur-wild');
  const uid = (
    await owner.query('select id from app_user where entra_oid = $1', [persona('monteur-wild').oid])
  ).rows[0].id;
  const [own] = (
    await owner.query(
      'select o.customer_no, o.bc_company_id from service_order o join assignment a on a.order_id = o.id where a.user_id = $1 limit 1',
      [uid],
    )
  ).rows;
  await owner.query(
    `insert into bc_remark (bc_company_id, scope, ref_no, kind, line_no, text) values ($1, 'CUSTOMER', $2, 'General', 99000, 'Eigener Kunde'),
      ($1, 'CUSTOMER', 'FREMD-1', 'General', 99000, 'Fremder Kunde')`,
    [own.bc_company_id, own.customer_no],
  );
  await owner.query(
    `insert into bc_contact (bc_company_id, number, customer_no, name) values ($1, 'KT-TEST', $2, 'Hinrich Test')
     on conflict do nothing`,
    [own.bc_company_id, own.customer_no],
  );
  const pull = await api(app)
    .get('/v1/sync/pull')
    .set({ Authorization: `Bearer ${token}` });
  const texts = pull.body.remarks.map((r: { text: string }) => r.text);
  expect(texts).toContain('Eigener Kunde');
  expect(texts).not.toContain('Fremder Kunde');
  expect(pull.body.contacts.map((c: { name: string }) => c.name)).toContain('Hinrich Test');
});
