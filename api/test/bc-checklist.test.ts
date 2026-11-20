/**
 * Yellow card from BC (OP-44): the app reads the checklist lines of the BC service order, the Monteur fills them
 * in, and on hand-over every answered line is written back into the BC checklist (PATCH), not as comment text.
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildMockServer } from '@schroeder/bc-mock';
import type { CommandType } from '@schroeder/shared';
import { BcClient } from '../src/bc/bc-client.js';
import { BcSyncService } from '../src/bc/bc-sync.service.js';
import { BcTransferWorker } from '../src/bc/transfer-worker.js';
import { AuditService } from '../src/common/audit.service.js';
import { createDb } from '../src/db/client.js';
import { AbsenceService } from '../src/modules/absence/absence.service.js';
import { ApprovalsService } from '../src/modules/approvals/approvals.service.js';
import { runAutoApprove } from '../src/modules/approvals/auto-approve.js';
import { ReportService } from '../src/modules/docs/report.service.js';
import { TimeService } from '../src/modules/time/time.service.js';
import { TransferService } from '../src/modules/transfer/transfer.service.js';
import { TEST_NOW } from './constants.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';

const { app: mock, state } = buildMockServer({ now: TEST_NOW, pageSize: 500 });
let app: NestExpressApplication;
let owner: pg.Client;
let workerDb: ReturnType<typeof createDb>;
let transfer: BcTransferWorker;
let token: string;
let order: { id: string; bc_no: string };
let seq = 11000;
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const push = (type: CommandType, payload: Record<string, unknown>) =>
  api(app)
    .post('/v1/sync/push')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      deviceId: 'bc-checklist-device',
      deviceNow: new Date().toISOString(),
      commands: [{ id: randomUUID(), type, deviceTime: new Date().toISOString(), deviceSeq: ++seq, payload }],
    });

beforeAll(async () => {
  const base = await mock.listen({ port: 0, host: '127.0.0.1' });
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  const client = (companyId: string) =>
    new BcClient({
      apiBaseUrl: `${base}/api`,
      tokenUrl: `${base}/oauth2/token`,
      clientId: 'x',
      clientSecret: 'y',
      scope: 'z',
      companyId,
      backoffBaseMs: 1,
      maxRetries: 0,
    });
  transfer = new BcTransferWorker(workerDb.db, client);
  await q(`update setting set value = '{"bcLines": true}' where key = 'checklist'`);
  await new BcSyncService(workerDb.db, client).runAll();
  token = await tokenFor(app, 'azubi-wild');
  const uid = (await q('select id from app_user where entra_oid = $1', [persona('azubi-wild').oid]))[0].id;
  order = (
    await q(
      `select o.id, o.bc_no from service_order o join assignment a on a.order_id = o.id
       where a.user_id = $1 and a.cancelled_at is null and o.app_status in ('NEU', 'EINGEPLANT', 'IN_ARBEIT')
         and exists (select 1 from bc_checklist_line l where l.order_no = o.bc_no)
       order by o.bc_no desc limit 1`,
      [uid],
    )
  )[0];
});
afterAll(async () => {
  await q(`update setting set value = '{"bcLines": false}' where key = 'checklist'`);
  await workerDb.pool.end();
  await owner.end();
  await app.close();
  await mock.close();
});

it('the device gets the yellow card of the order from BC', async () => {
  expect(order).toBeTruthy();
  const pull = await api(app)
    .get('/v1/sync/pull')
    .set({ Authorization: `Bearer ${token}` });
  const def = pull.body.checklistDefs.find((d: { orderId: string }) => d.orderId === order.id);
  expect(def.items.length).toBeGreaterThan(50);
  expect(def.items.find((i: { text: string }) => i.text === 'Menge Motoröl')).toMatchObject({
    answer: 'number',
    unitOptions: ['Liter', 'St.'],
  });
});

it('answers go back into the BC checklist lines on hand-over', async () => {
  const pull = await api(app)
    .get('/v1/sync/pull')
    .set({ Authorization: `Bearer ${token}` });
  const def = pull.body.checklistDefs.find((d: { orderId: string }) => d.orderId === order.id);
  const byText = (t: string) => def.items.find((i: { text: string }) => i.text === t).id as string;
  const results: Record<string, { checked: boolean; value: string | null; unit: string | null }> = {
    [byText('Motoröl')]: { checked: true, value: null, unit: null },
    [byText('Menge Motoröl')]: { checked: false, value: '12', unit: 'Liter' },
  };
  for (const i of def.items as Array<{ id: string; required?: boolean }>)
    if (i.required) results[i.id] = { checked: true, value: null, unit: null };
  await push('SaveChecklist', { orderId: order.id, templateId: null, results }).expect(200);
  expect(
    (await q('select complete, source from order_checklist where order_id = $1', [order.id]))[0],
  ).toEqual({
    complete: true,
    source: 'bc',
  });

  await push('SaveWorkReport', {
    orderId: order.id,
    body: 'Ölwechsel durchgeführt.',
    requiredFields: { operatingHours: 1234 },
  });
  await push('SetOrderStatus', { orderId: order.id, status: 'FERTIG' }).expect(200);
  expect((await q('select app_status from service_order where id = $1', [order.id]))[0].app_status).toBe(
    'FERTIG',
  );

  await q("update bc_transfer set state = 'DONE' where state <> 'DONE'");
  const tr = new TransferService();
  const au = new AuditService();
  await runAutoApprove(
    workerDb.db,
    new ApprovalsService(
      workerDb.db,
      new TimeService(),
      tr,
      au,
      new ReportService(),
      new AbsenceService(workerDb.db, tr, au),
    ),
    () => undefined,
  );
  for (let i = 0; i < 6; i++) await transfer.runOnce();
  const lines = state.tables.serviceChecklistLines.filter((l) => l.documentNumber === order.bc_no);
  expect(lines.find((l) => l.description === 'Motoröl')).toMatchObject({ checked: true });
  expect(lines.find((l) => l.description === 'Menge Motoröl')).toMatchObject({
    answer: '12',
    answerUnit: 'Liter',
  });
  const comments = state.tables.serviceCommentLines.filter((c) => c.documentNumber === order.bc_no);
  expect(comments.some((c) => String(c.comment).startsWith('Checkliste'))).toBe(false);
  expect(await q("select target, last_error from bc_transfer where state <> 'DONE'")).toEqual([]);
});
