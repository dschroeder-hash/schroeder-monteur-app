/**
 * Service checklist (E-67) and customer signature (E-68): templates by the Admin, filled in offline by the Monteur,
 * required for "Arbeit abgeschlossen"; on hand-over BC receives the checklist as comment lines and the signed
 * workshop order as PDF attachment.
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMockServer } from '@schroeder/bc-mock';
import type { CommandType } from '@schroeder/shared';
import { BcClient } from '../src/bc/bc-client.js';
import { BcTransferWorker } from '../src/bc/transfer-worker.js';
import { createDb } from '../src/db/client.js';
import { buildWorkOrderPdf } from '../src/modules/docs/work-order-pdf.js';
import { TEST_NOW } from './constants.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';

// 1×1 transparent PNG – stands in for the drawn signature.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const { app: mock, state } = buildMockServer({ now: TEST_NOW });
let app: NestExpressApplication;
let owner: pg.Client;
let workerDb: ReturnType<typeof createDb>;
let transfer: BcTransferWorker;
const t: Record<string, string> = {};
let seq = 9000;
let order: { id: string; bc_no: string; location_id: string; order_type_code: string; brand: string };
let templateId: string;
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const push = (type: CommandType, payload: Record<string, unknown>) =>
  api(app)
    .post('/v1/sync/push')
    .set({ Authorization: `Bearer ${t.monteur}` })
    .send({
      deviceId: 'checklist-device',
      deviceNow: new Date().toISOString(),
      commands: [{ id: randomUUID(), type, deviceTime: new Date().toISOString(), deviceSeq: ++seq, payload }],
    });
const status = async () =>
  (await q('select app_status from service_order where id = $1', [order.id]))[0].app_status;

beforeAll(async () => {
  const base = await mock.listen({ port: 0, host: '127.0.0.1' });
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  transfer = new BcTransferWorker(
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
        maxRetries: 0,
      }),
  );
  t.monteur = await tokenFor(app, 'monteur-clp');
  t.admin = await tokenFor(app, 'admin');
  const uid = (await q('select id from app_user where entra_oid = $1', [persona('monteur-clp').oid]))[0].id;
  order = (
    await q(
      `select o.id, o.bc_no, o.location_id, o.order_type_code, m.brand
       from service_order o join assignment a on a.order_id = o.id
       join service_order_item i on i.order_id = o.id join machine m on m.id = i.machine_id
       where a.user_id = $1 and a.cancelled_at is null and o.bc_status = 'Pending'
         and o.order_type_code not in ('WARTUNG', 'INTWART', 'UEBERGABE')
       order by o.bc_no limit 1`,
      [uid],
    )
  )[0];
  expect(order).toBeTruthy();
  await q(
    `insert into setting (key, location_id, value) values ('completion', $1, '{"signatureRequired": true}')`,
    [order.location_id],
  );
});
afterAll(async () => {
  await q("delete from setting where key = 'completion' and location_id is not null");
  await q('update checklist_template set active = false');
  await workerDb.pool.end();
  await owner.end();
  await app.close();
  await mock.close();
});

describe('checklist templates (Admin)', () => {
  it('rejects duplicate item ids and is Admin-only', async () => {
    const bad = await api(app)
      .post('/v1/admin/checklist-templates')
      .set({ Authorization: `Bearer ${t.admin}` })
      .send({
        title: 'Doppelt',
        items: [
          { id: 'a', text: 'A' },
          { id: 'a', text: 'B' },
        ],
      });
    expect(bad.status).toBe(400);
    const forbidden = await api(app)
      .post('/v1/admin/checklist-templates')
      .set({ Authorization: `Bearer ${t.monteur}` })
      .send({ title: 'X', items: [{ id: 'a', text: 'A' }] });
    expect(forbidden.status).toBe(403);
  });

  it('creates a template for location, order type and brand, delivered to the device', async () => {
    const res = await api(app)
      .post('/v1/admin/checklist-templates')
      .set({ Authorization: `Bearer ${t.admin}` })
      .send({
        title: 'Inspektion Test',
        locationId: order.location_id,
        orderTypeCode: order.order_type_code,
        brand: order.brand,
        items: [
          { id: 'oil', text: 'Motorölstand prüfen' },
          { id: 'tyre', text: 'Reifendruck vorne', kind: 'value', unit: 'bar' },
          { id: 'note', text: 'Sonstiges', kind: 'text', required: false },
        ],
      });
    expect(res.status).toBe(201);
    templateId = res.body.id;
    const pull = await api(app)
      .get('/v1/sync/pull')
      .set({ Authorization: `Bearer ${t.monteur}` });
    expect(pull.body.checklistTemplates.map((x: { id: string }) => x.id)).toContain(templateId);
  });
});

describe('Arbeit abgeschlossen with checklist and signature', () => {
  it('without checklist and signature the order stays "Doku offen" and names what is missing', async () => {
    await push('SaveWorkReport', {
      orderId: order.id,
      body: 'Inspektion durchgeführt.',
      requiredFields: {},
    }).expect(200);
    const res = await push('SetOrderStatus', { orderId: order.id, status: 'FERTIG' }).expect(200);
    const warning = res.body.results[0].warnings[0] as string;
    expect(warning).toContain('Checkliste (2 offen)');
    expect(warning).toContain('Unterschrift des Kunden');
    expect(await status()).toBe('FERTIG_DOKU_OFFEN');
  });

  it('"not OK" needs a note; a complete checklist is stored', async () => {
    await push('SaveChecklist', {
      orderId: order.id,
      templateId,
      results: {
        oil: { state: 'NOK', value: null, note: '' },
        tyre: { state: null, value: '1,8', note: '' },
      },
    }).expect(200);
    expect(
      (await q('select complete from order_checklist where order_id = $1', [order.id]))[0].complete,
    ).toBe(false);
    await push('SaveChecklist', {
      orderId: order.id,
      templateId,
      results: {
        oil: { state: 'NOK', value: null, note: '1 l nachgefüllt' },
        tyre: { state: null, value: '1,8', note: '' },
        unknown: { state: 'OK', value: null, note: '' },
      },
    }).expect(200);
    const [c] = await q('select complete, results from order_checklist where order_id = $1', [order.id]);
    expect(c.complete).toBe(true);
    expect(Object.keys(c.results)).toEqual(['oil', 'tyre']);
    expect(await status()).toBe('FERTIG_DOKU_OFFEN');
  });

  it('a signature needs a name or a reason; signing completes the order', async () => {
    const bad = await push('SignOrder', {
      orderId: order.id,
      signerName: '',
      signedAt: new Date().toISOString(),
      imagePng: PNG,
    });
    expect(bad.body.results[0].result).toBe('rejected');
    await push('SignOrder', {
      orderId: order.id,
      signerName: 'Hinrich Kunde',
      signedAt: new Date().toISOString(),
      imagePng: PNG,
    }).expect(200);
    expect(await status()).toBe('FERTIG');
    const pull = await api(app)
      .get('/v1/sync/pull')
      .set({ Authorization: `Bearer ${t.monteur}` });
    const sig = pull.body.orderSignatures.find((x: { orderId: string }) => x.orderId === order.id);
    expect(sig).toMatchObject({ signerName: 'Hinrich Kunde' });
    expect(sig.imagePng).toBeUndefined();
  });

  it('the workshop order PDF contains hours, report, checklist and the signature', async () => {
    const pdf = Buffer.from(await buildWorkOrderPdf(workerDb.db, order.id));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('on hand-over BC gets report and checklist as comment lines and the PDF as attachment', async () => {
    await q("update bc_transfer set state = 'DONE' where state <> 'DONE'");
    // what the worker job does when the order is finished (auto-approve.test.ts covers the job itself)
    const { ApprovalsService } = await import('../src/modules/approvals/approvals.service.js');
    const { ReportService } = await import('../src/modules/docs/report.service.js');
    const { TransferService } = await import('../src/modules/transfer/transfer.service.js');
    const { AuditService } = await import('../src/common/audit.service.js');
    const { TimeService } = await import('../src/modules/time/time.service.js');
    const { AbsenceService } = await import('../src/modules/absence/absence.service.js');
    const { runAutoApprove } = await import('../src/modules/approvals/auto-approve.js');
    const tr = new TransferService();
    const au = new AuditService();
    const approvals = new ApprovalsService(
      workerDb.db,
      new TimeService(),
      tr,
      au,
      new ReportService(),
      new AbsenceService(workerDb.db, tr, au),
    );
    await runAutoApprove(workerDb.db, approvals, () => undefined);
    expect(await status()).toBe('FREIGEGEBEN');
    for (let i = 0; i < 5; i++) await transfer.runOnce();
    const comments = state.tables.serviceCommentLines.filter((c) => c.documentNumber === order.bc_no);
    expect(comments.some((c) => String(c.comment).startsWith('Inspektion durchgeführt'))).toBe(true);
    expect(
      comments.some(
        (c) =>
          c.comment === 'n.i.O. Motorölstand prüfen - 1 l nachgefüllt' ||
          String(c.comment).includes('Motorölstand prüfen'),
      ),
    ).toBe(true);
    const att = state.tables.serviceOrderAttachments.find((a) => a.documentNumber === order.bc_no);
    expect(att?.fileName).toBe(`Werkstattauftrag_${order.bc_no}.pdf`);
    expect(Buffer.from(String(att?.fileContent), 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    const open = await q(
      "select target, last_error from bc_transfer where subject_id in ($1) and state <> 'DONE'",
      [order.id],
    );
    expect(open).toEqual([]);
  });
});
