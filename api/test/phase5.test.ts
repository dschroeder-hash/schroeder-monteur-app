/** Phase 5: work report, templates, photos (resumable upload), chat, notifications, push, reminders, retention. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandType } from '@schroeder/shared';
import { buildMockServer } from '@schroeder/bc-mock';
import { BcClient } from '../src/bc/bc-client.js';
import { BcTransferWorker } from '../src/bc/transfer-worker.js';
import { createDb } from '../src/db/client.js';
import { applyRetention } from '../src/jobs.js';
import { AzureSpeech } from '../src/modules/files/speech.js';
import { deliverPush, remindForgottenClockOut, type PushSender } from '../src/modules/files/push.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';
import { TEST_NOW } from './constants.js';

const { app: mock, state } = buildMockServer({ now: TEST_NOW });
let app: NestExpressApplication;
let owner: pg.Client;
let workerDb: ReturnType<typeof createDb>;
let worker: BcTransferWorker;
const t = {} as Record<string, string>;
const ids = {} as Record<string, string>;
let seq = 9000;

const as = (who: string) => ({ Authorization: `Bearer ${t[who]}` });
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const push = (
  who: string,
  type: CommandType,
  payload: Record<string, unknown>,
  opts: { id?: string; at?: Date } = {},
) =>
  api(app)
    .post('/v1/sync/push')
    .set(as(who))
    .send({
      deviceId: 'phase5-device',
      deviceNow: new Date().toISOString(),
      commands: [
        {
          id: opts.id ?? randomUUID(),
          type,
          deviceTime: (opts.at ?? new Date()).toISOString(),
          deviceSeq: ++seq,
          payload,
        },
      ],
    });
const path = (url: string) => new URL(url).pathname + new URL(url).search;

beforeAll(async () => {
  const base = await mock.listen({ port: 0, host: '127.0.0.1' });
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  worker = new BcTransferWorker(
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
  for (const p of ['monteur-wild', 'monteur-clp', 'meister-wild', 'meister-clp', 'admin']) {
    t[p] = await tokenFor(app, p);
    ids[p] = (await q('select id from app_user where entra_oid = $1', [persona(p).oid]))[0].id;
  }
  // A maintenance order (requires operating hours) assigned to monteur-wild.
  ids.order = (
    await q(
      "select o.id from service_order o join assignment a on a.order_id = o.id where a.user_id = $1 and a.cancelled_at is null and o.bc_status = 'Pending' order by o.bc_no desc limit 1",
      [ids['monteur-wild']],
    )
  )[0].id;
  await q("update service_order set order_type_code = 'WARTUNG', app_status = 'IN_ARBEIT' where id = $1", [
    ids.order,
  ]);
  await q("update bc_transfer set state = 'DONE'");
});
afterAll(async () => {
  await workerDb.pool.end();
  await owner.end();
  await app.close();
  await mock.close();
});

describe('work report and status coupling', () => {
  it('"Fertig" with incomplete documentation becomes "Fertig – Doku offen"', async () => {
    await push('monteur-wild', 'SaveWorkReport', {
      orderId: ids.order,
      body: 'Wartung nach Herstellerplan durchgeführt.',
      requiredFields: {},
    }).expect(200);
    const res = await push('monteur-wild', 'SetOrderStatus', { orderId: ids.order, status: 'FERTIG' });
    expect(res.body.results[0].warnings[0]).toContain('Betriebsstunden');
    expect((await q('select app_status from service_order where id = $1', [ids.order]))[0].app_status).toBe(
      'FERTIG_DOKU_OFFEN',
    );
  });

  it('completing the documentation moves the order to "Fertig"; a chat system message is written', async () => {
    const text = `Wartung nach Herstellerplan durchgeführt. Motoröl, Getriebe-/Hydrauliköl und alle Filter gewechselt. Fehlerspeicher ausgelesen, Fehler behoben und Speicher gelöscht. Probefahrt ohne Befund.`;
    await push('monteur-wild', 'SaveWorkReport', {
      orderId: ids.order,
      body: text,
      requiredFields: { operatingHours: 4210 },
    }).expect(200);
    expect((await q('select app_status from service_order where id = $1', [ids.order]))[0].app_status).toBe(
      'FERTIG',
    );
    const sys = await q(
      'select body from chat_message where order_id = $1 and is_system order by server_seq',
      [ids.order],
    );
    expect(sys.map((r) => r.body)).toEqual(
      expect.arrayContaining(['Status: Fertig – Doku offen', 'Status: Fertig']),
    );
  });

  it('an older offline version does not overwrite a newer report', async () => {
    const res = await push(
      'monteur-wild',
      'SaveWorkReport',
      { orderId: ids.order, body: 'alt', requiredFields: {} },
      { at: new Date(Date.now() - 3_600_000) },
    );
    expect(res.body.results[0].warnings[0]).toContain('archiviert');
    expect((await q('select body from work_report where order_id = $1', [ids.order]))[0].body).toContain(
      'Probefahrt',
    );
  });

  it('pull delivers report and templates', async () => {
    const res = await api(app).get('/v1/sync/pull').set(as('monteur-wild'));
    expect(res.body.workReports.find((r: { orderId: string }) => r.orderId === ids.order).complete).toBe(
      true,
    );
    expect(res.body.templates.length).toBeGreaterThanOrEqual(6);
  });

  it('Meister approval sends the report as ≤80-char comment lines to BC before the status', async () => {
    await api(app)
      .post(`/v1/orders/${ids.order}/status`)
      .set(as('meister-wild'))
      .send({ status: 'FREIGEGEBEN' })
      .expect(200);
    await worker.runOnce();
    const bcNo = (await q('select bc_no from service_order where id = $1', [ids.order]))[0].bc_no;
    const lines = state.tables.serviceCommentLines
      .filter((l) => l.documentNumber === bcNo)
      .map((l) => String(l.comment));
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((l) => l.length <= 80)).toBe(true);
    expect(lines).toContain('Betriebsstunden: 4.210 h');
    const writes = state.writeLog.filter(
      (w) => w.entitySet.startsWith('serviceCommentLines') || w.method === 'PATCH',
    );
    expect(writes.at(-1)!.method).toBe('PATCH'); // status after the comments
    const after = await push('monteur-wild', 'SaveWorkReport', {
      orderId: ids.order,
      body: 'nachträglich',
      requiredFields: {},
    });
    expect(after.body.results[0].result).toBe('rejected');
  });
});

describe('photos: resumable block upload to private storage', () => {
  const photoId = randomUUID();
  const block1 = Buffer.alloc(1024, 1);
  const block2 = Buffer.alloc(700, 2);
  let order2: string;

  it('metadata via sync, blocks via short-lived URL, resume, commit, read', async () => {
    order2 = (
      await q(
        "select a.order_id from assignment a join service_order o on o.id = a.order_id where a.user_id = $1 and a.cancelled_at is null and o.app_status not in ('FREIGEGEBEN','ABGERECHNET') limit 1",
        [ids['monteur-wild']],
      )
    )[0].order_id;
    await push(
      'monteur-wild',
      'AttachPhoto',
      {
        orderId: order2,
        category: 'TYPENSCHILD',
        capturedAt: new Date().toISOString(),
        width: 2000,
        height: 1500,
        sizeBytes: 1724,
      },
      { id: photoId },
    ).expect(200);
    const target = await api(app).post(`/v1/photos/${photoId}/upload-target`).set(as('monteur-wild'));
    expect(target.body.url).toContain('/v1/blob/');
    const u = path(target.body.url);
    await api(app)
      .put(`${u.split('?')[0]}?comp=block&blockid=YmxvY2stMDAwMQ==`)
      .set('content-type', 'application/octet-stream')
      .send(block1)
      .expect(201);
    // connection lost → client asks which blocks the server already has
    const list = await api(app).get(`${u.split('?')[0]}?comp=blocklist&blocklisttype=uncommitted`);
    expect(list.text).toContain('<Name>YmxvY2stMDAwMQ==</Name>');
    await api(app)
      .put(`${u.split('?')[0]}?comp=block&blockid=YmxvY2stMDAwMg==`)
      .set('content-type', 'application/octet-stream')
      .send(block2)
      .expect(201);
    await api(app)
      .put(`${u.split('?')[0]}?comp=blocklist`)
      .set('content-type', 'application/xml')
      .send(
        '<?xml version="1.0"?><BlockList><Latest>YmxvY2stMDAwMQ==</Latest><Latest>YmxvY2stMDAwMg==</Latest></BlockList>',
      )
      .expect(201);
    const done = await api(app).post(`/v1/photos/${photoId}/complete`).set(as('monteur-wild'));
    expect(done.body.sizeBytes).toBe(1724);
    const read = await api(app).get(`/v1/photos/${photoId}/url`).set(as('meister-wild'));
    const img = await api(app)
      .get(path(read.body.url))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(Buffer.compare(img.body as Buffer, Buffer.concat([block1, block2]))).toBe(0);
  });

  it('other locations, other uploaders and forged links get nothing', async () => {
    expect((await api(app).get(`/v1/photos/${photoId}/url`).set(as('monteur-clp'))).status).toBe(404);
    expect((await api(app).post(`/v1/photos/${photoId}/upload-target`).set(as('meister-wild'))).status).toBe(
      404,
    );
    expect((await api(app).get('/v1/blob/Zm9vfHJ8OTk5OTk5OTk5OTk5OQ.abc')).status).toBe(403);
    const list = await api(app).get(`/v1/orders/${order2}/photos`).set(as('meister-clp'));
    expect(list.status).toBe(404);
  });
});

describe('chat', () => {
  let order3: string;
  it('offline messages arrive in device order; Meister answers; read receipts', async () => {
    order3 = (
      await q(
        "select a.order_id from assignment a join service_order o on o.id = a.order_id where a.user_id = $1 and a.cancelled_at is null and o.app_status not in ('FREIGEGEBEN','ABGERECHNET') order by o.bc_no limit 1",
        [ids['monteur-wild']],
      )
    )[0].order_id;
    const now = Date.now();
    const cmds = [
      {
        id: randomUUID(),
        type: 'SendChatMessage',
        deviceTime: new Date(now - 60_000).toISOString(),
        deviceSeq: ++seq,
        payload: { orderId: order3, body: 'Hydraulikschlauch undicht' },
      },
      {
        id: randomUUID(),
        type: 'SendChatMessage',
        deviceTime: new Date(now - 30_000).toISOString(),
        deviceSeq: ++seq,
        payload: { orderId: order3, body: 'Habe Ersatz bestellt' },
      },
    ];
    // sent in reverse order (e.g. two sync attempts) – server applies device order
    await api(app)
      .post('/v1/sync/push')
      .set(as('monteur-wild'))
      .send({ deviceId: 'phase5-device', deviceNow: new Date().toISOString(), commands: [...cmds].reverse() })
      .expect(200);
    const list = await api(app).get(`/v1/orders/${order3}/chat`).set(as('meister-wild'));
    const own = list.body.messages
      .filter((m: { isSystem: boolean }) => !m.isSystem)
      .map((m: { body: string }) => m.body);
    expect(own.slice(-2)).toEqual(['Hydraulikschlauch undicht', 'Habe Ersatz bestellt']);
    expect(
      (
        await q("select count(*)::int as n from notification where user_id = $1 and kind = 'CHAT'", [
          ids['meister-wild'],
        ])
      )[0].n,
    ).toBeGreaterThanOrEqual(2);

    await api(app)
      .post(`/v1/orders/${order3}/chat`)
      .set(as('meister-wild'))
      .send({ body: 'Danke, Teil kommt morgen.' })
      .expect(201);
    const pull = await api(app).get('/v1/sync/pull').set(as('monteur-wild'));
    const reply = pull.body.chatMessages.find(
      (m: { body: string }) => m.body === 'Danke, Teil kommt morgen.',
    );
    expect(reply.authorName).toContain('Gerdes');
    await push('monteur-wild', 'MarkChatRead', { orderId: order3, upToServerSeq: reply.serverSeq }).expect(
      200,
    );
    await api(app)
      .post(`/v1/orders/${order3}/chat/read`)
      .set(as('meister-wild'))
      .send({ upToServerSeq: reply.serverSeq })
      .expect(200);
    const again = await api(app).get(`/v1/orders/${order3}/chat`).set(as('meister-wild'));
    expect(again.body.messages.find((m: { id: string }) => m.id === reply.id).readBy).toContain(
      ids['monteur-wild'],
    );
    const mine = await api(app).get('/v1/sync/pull').set(as('monteur-wild'));
    expect(mine.body.chatReads.some((r: { userId: string }) => r.userId === ids['meister-wild'])).toBe(true);
  });

  it('a Meister of another location cannot read or write', async () => {
    expect((await api(app).get(`/v1/orders/${order3}/chat`).set(as('meister-clp'))).status).toBe(404);
    expect(
      (await api(app).post(`/v1/orders/${order3}/chat`).set(as('meister-clp')).send({ body: 'x' })).status,
    ).toBe(404);
  });
});

describe('notifications and Web Push', () => {
  it('lists own notifications and marks them read', async () => {
    const list = await api(app).get('/v1/notifications').set(as('meister-wild'));
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body.every((n: { userId: string }) => n.userId === ids['meister-wild'])).toBe(true);
    await api(app).post('/v1/notifications/read').set(as('meister-wild')).send({ all: true }).expect(200);
    expect(
      (
        await q('select count(*)::int as n from notification where user_id = $1 and read_at is null', [
          ids['meister-wild'],
        ])
      )[0].n,
    ).toBe(0);
  });

  it('delivers pending notifications to subscriptions and drops expired ones', async () => {
    await api(app)
      .post('/v1/push/subscriptions')
      .set(as('meister-wild'))
      .send({
        endpoint: 'https://push.example.invalid/ok',
        keys: { p256dh: 'BOr8kL8YvL8Q2xYz', auth: 'abcdefghijkl' },
      })
      .expect(200);
    await api(app)
      .post('/v1/push/subscriptions')
      .set(as('meister-wild'))
      .send({
        endpoint: 'https://push.example.invalid/gone',
        keys: { p256dh: 'BOr8kL8YvL8Q2xYz', auth: 'abcdefghijkl' },
      })
      .expect(200);
    await q(
      "insert into notification (user_id, kind, title, body) values ($1, 'TEST', 'Testtitel', 'Testtext')",
      [ids['meister-wild']],
    );
    const sent: string[] = [];
    const sender: PushSender = {
      async send(sub, payload) {
        sent.push(`${sub.endpoint} ${payload}`);
        return { gone: sub.endpoint.endsWith('/gone') };
      },
    };
    const r = await deliverPush(workerDb.db, sender);
    expect(r.gone).toBeGreaterThanOrEqual(1);
    expect(sent.some((x) => x.includes('/ok') && x.includes('Testtitel'))).toBe(true);
    expect(
      (await q("select count(*)::int as n from push_subscription where endpoint like '%/gone'"))[0].n,
    ).toBe(0);
    expect((await deliverPush(workerDb.db, sender)).sent).toBe(0); // nothing twice
  });

  it('reminds once per day about a forgotten clock-out after the configured time', async () => {
    await q(
      'insert into setting (location_id, key, value) values (null, \'forgotClockOutReminder\', \'{"time":"00:00"}\') on conflict do nothing',
    );
    await q(
      'update setting set value = \'{"time":"00:00"}\' where key = \'forgotClockOutReminder\' and location_id is null',
    );
    await push('monteur-clp', 'StampClockIn', {}, { at: new Date(Date.now() - 60_000) }).expect(200);
    await remindForgottenClockOut(workerDb.db);
    await remindForgottenClockOut(workerDb.db);
    expect(
      (
        await q(
          "select count(*)::int as n from notification where user_id = $1 and kind = 'FORGOT_CLOCK_OUT'",
          [ids['monteur-clp']],
        )
      )[0].n,
    ).toBe(1);
  });
});

describe('retention (PROMPT 9)', () => {
  it('removes chat texts and photos of orders billed longer ago than the retention period', async () => {
    const o = (await q('select distinct order_id from chat_message where not is_system limit 1'))[0].order_id;
    await q("update service_order set billed_at = now() - interval '3 years' where id = $1", [o]);
    const deleted: string[] = [];
    const r = await applyRetention(workerDb.db, async (p) => void deleted.push(p));
    expect(r.messages).toBeGreaterThan(0);
    expect(
      (
        await q('select count(*)::int as n from chat_message where order_id = $1 and deleted_at is null', [o])
      )[0].n,
    ).toBe(0);
  });
});

describe('dictation and templates', () => {
  it('server dictation is optional; Azure Speech adapter parses the result', async () => {
    const res = await api(app)
      .post('/v1/speech/transcribe')
      .set(as('monteur-wild'))
      .set('content-type', 'audio/wav')
      .send(Buffer.alloc(100));
    expect(res.status).toBe(501);
    const s = new AzureSpeech('germanywestcentral', 'k', (async (url: string) => {
      expect(url).toContain('germanywestcentral.stt.speech.microsoft.com');
      expect(url).toContain('language=de-DE');
      return new Response(JSON.stringify({ RecognitionStatus: 'Success', DisplayText: 'Öl gewechselt.' }));
    }) as typeof fetch);
    expect(await s.transcribe(Buffer.alloc(10), 'audio/wav')).toBe('Öl gewechselt.');
    expect(
      (await api(app).post('/v1/speech/rewrite').set(as('monteur-wild')).send({ text: 'öl gewechselt' }))
        .status,
    ).toBe(501);
  });

  it('Meister maintains templates for his location only; Admin also global ones', async () => {
    const wild = (await q("select id from location where code = 'WILD'"))[0].id;
    const clp = (await q("select id from location where code = 'CLP'"))[0].id;
    expect(
      (
        await api(app)
          .post('/v1/templates')
          .set(as('meister-wild'))
          .send({ locationId: wild, title: 'Riemen', body: 'Keilriemen gespannt.' })
      ).status,
    ).toBe(201);
    expect(
      (
        await api(app)
          .post('/v1/templates')
          .set(as('meister-wild'))
          .send({ locationId: clp, title: 'xy', body: 'yy' })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(app)
          .post('/v1/templates')
          .set(as('meister-wild'))
          .send({ locationId: null, title: 'xy', body: 'yy' })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(app)
          .post('/v1/templates')
          .set(as('admin'))
          .send({ locationId: null, title: 'Global', body: 'Für alle.' })
      ).status,
    ).toBe(201);
  });
});
