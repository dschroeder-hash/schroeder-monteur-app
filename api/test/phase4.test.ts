/** Phase 4: parts and consumables – withdrawal, stock, approval → BC, part requests, search, catalogs. */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandType } from '@schroeder/shared';
import { buildMockServer } from '@schroeder/bc-mock';
import { BcClient } from '../src/bc/bc-client.js';
import { BcSyncService } from '../src/bc/bc-sync.service.js';
import { BcTransferWorker } from '../src/bc/transfer-worker.js';
import { createDb } from '../src/db/client.js';
import { api, createTestApp, persona, tokenFor } from './helpers.js';
import { TEST_NOW } from './constants.js';

const { app: mock, state } = buildMockServer({ now: TEST_NOW });
let app: NestExpressApplication;
let owner: pg.Client;
let base: string;
let worker: BcTransferWorker;
let bcSync: BcSyncService;
let workerDb: ReturnType<typeof createDb>;
const t = {} as Record<string, string>;
const ids = {} as Record<string, string>;
let seq = 5000;

const as = (who: string) => ({ Authorization: `Bearer ${t[who]}` });
const q = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const push = (who: string, type: CommandType, payload: Record<string, unknown>, id: string = randomUUID()) =>
  api(app)
    .post('/v1/sync/push')
    .set(as(who))
    .send({
      deviceId: 'phase4-device',
      deviceNow: new Date().toISOString(),
      commands: [{ id, type, deviceTime: new Date().toISOString(), deviceSeq: ++seq, payload }],
    });
const stock = async (itemNo: string, storageCode: string) =>
  (
    await q(
      'select s.bc_inventory::float as bc, s.pending_withdrawal::float as pending from item_stock s join item i on i.id = s.item_id join storage_location l on l.id = s.storage_location_id where i.number = $1 and l.bc_location_code = $2',
      [itemNo, storageCode],
    )
  )[0] as { bc: number; pending: number };
const containerOf = async (itemNo: string, code = 'WILD') =>
  (
    await q(
      'select c.* from container c join item i on i.id = c.item_id join location l on l.id = c.location_id where i.number = $1 and l.code = $2',
      [itemNo, code],
    )
  )[0];

beforeAll(async () => {
  base = await mock.listen({ port: 0, host: '127.0.0.1' });
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  const clientFor = (companyId: string) =>
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
  worker = new BcTransferWorker(workerDb.db, clientFor);
  bcSync = new BcSyncService(workerDb.db, clientFor);
  for (const p of ['monteur-wild', 'meister-wild', 'meister-clp', 'lager-wild', 'admin']) {
    t[p] = await tokenFor(app, p);
    ids[p] = (await q('select id from app_user where entra_oid = $1', [persona(p).oid]))[0].id;
  }
  ids.order = (
    await q(
      "select o.id from service_order o join assignment a on a.order_id = o.id where a.user_id = $1 and a.cancelled_at is null and o.bc_status = 'Pending' order by o.bc_no limit 1",
      [ids['monteur-wild']],
    )
  )[0].id;
  ids.wh = (await q("select id from storage_location where bc_location_code = 'WILD'"))[0].id;
  ids.tank = (await q("select id from storage_location where bc_location_code = 'WILD-TANK'"))[0].id;
  await q("update bc_transfer set state = 'DONE'");
  await q("update service_order set app_status = 'IN_ARBEIT' where id = $1", [ids.order]);
});
afterAll(async () => {
  await workerDb.pool.end();
  await owner.end();
  await app.close();
  await mock.close();
});

describe('offline catalog in the pull', () => {
  it('contains consumables, stocked items, stock rows and containers of the own location', async () => {
    const res = await api(app).get('/v1/sync/pull').set(as('monteur-wild'));
    expect(res.status).toBe(200);
    expect(res.body.containers).toHaveLength(6);
    expect(
      res.body.items.some(
        (i: { number: string; isConsumable: boolean }) => i.number === 'DIESEL' && i.isConsumable,
      ),
    ).toBe(true);
    expect(res.body.items.find((i: { gtin: string }) => i.gtin === '4012345100018').barcodes).toContain(
      '4012345100018',
    );
    const storages = new Set(res.body.storages.map((s: { id: string }) => s.id));
    expect(
      res.body.stocks.every((s: { storageLocationId: string }) => storages.has(s.storageLocationId)),
    ).toBe(true);
  });
});

describe('acceptance 5.4: 12 l engine oil on an order', () => {
  let consumptionId: string;
  let before: { bc: number; pending: number };

  it('withdrawal reduces the available stock immediately', async () => {
    before = await stock('X990.200.000', 'WILD');
    const fass = await containerOf('X990.200.000');
    consumptionId = randomUUID();
    const res = await push(
      'monteur-wild',
      'ConsumeItem',
      {
        orderId: ids.order,
        itemId: fass.item_id,
        storageLocationId: ids.wh,
        containerId: fass.id,
        quantity: 12,
      },
      consumptionId,
    );
    expect(res.body.results[0].result).toBe('applied');
    expect((await stock('X990.200.000', 'WILD')).pending).toBe(before.pending + 12);
    // replay → no double reduction
    const again = await push(
      'monteur-wild',
      'ConsumeItem',
      {
        orderId: ids.order,
        itemId: fass.item_id,
        storageLocationId: ids.wh,
        containerId: fass.id,
        quantity: 12,
      },
      consumptionId,
    );
    expect(again.body.results[0].result).toBe('duplicate');
    expect((await stock('X990.200.000', 'WILD')).pending).toBe(before.pending + 12);
  });

  it('search shows BC inventory minus the pending withdrawal', async () => {
    const res = await api(app).get('/v1/items/search?q=Motoröl').set(as('monteur-wild'));
    const row = res.body.find((i: { number: string }) => i.number === 'X990.200.000');
    expect(row.stock.find((s: { bcLocationCode: string }) => s.bcLocationCode === 'WILD').available).toBe(
      before.bc - before.pending - 12,
    );
  });

  it('Meister approves → BC service line of type Item with 12 L at the order', async () => {
    const inbox = await api(app)
      .get(`/v1/approvals/inbox?locationId=${(await q("select id from location where code='WILD'"))[0].id}`)
      .set(as('meister-wild'));
    const c = inbox.body.consumptions.find((x: { id: string }) => x.id === consumptionId);
    expect(c).toMatchObject({ quantity: 12, unit: 'L', itemNumber: 'X990.200.000' });
    await api(app)
      .post('/v1/approvals/consumptions')
      .set(as('meister-wild'))
      .send({ ids: [consumptionId] })
      .expect(200);
    await worker.runOnce();
    const bcNo = (await q('select bc_no from service_order where id = $1', [ids.order]))[0].bc_no;
    const line = state.tables.serviceLines.find(
      (l) => l.documentNumber === bcNo && l.type === 'Item' && l.number === 'X990.200.000',
    );
    expect(line).toMatchObject({ quantity: 12, unitOfMeasureCode: 'L', locationCode: 'WILD' });
    expect((await q('select state from consumption where id = $1', [consumptionId]))[0].state).toBe(
      'TRANSFERRED',
    );
  });

  it('after posting in BC the stock stays correct (no double subtraction)', async () => {
    const shown = (await stock('X990.200.000', 'WILD')).bc - (await stock('X990.200.000', 'WILD')).pending;
    const bcNo = (await q('select bc_no from service_order where id = $1', [ids.order]))[0].bc_no;
    const line = state.tables.serviceLines.find(
      (l) => l.documentNumber === bcNo && l.number === 'X990.200.000',
    )!;
    const avail = state.tables.itemAvailabilities.find(
      (a) => a.itemNumber === 'X990.200.000' && a.locationCode === 'WILD',
    )!;
    // BC user posts "ship and consume": inventory −12, line consumed 12
    line.quantityConsumed = 12;
    line.lastModifiedDateTime = new Date(Date.now() + 2000).toISOString();
    avail.inventory = Number(avail.inventory) - 12;
    avail.lastModifiedDateTime = new Date(Date.now() + 2000).toISOString();
    await bcSync.runAll();
    const after = await stock('X990.200.000', 'WILD');
    expect(after.bc - after.pending).toBe(shown);
    expect(
      (await q('select bc_posted_qty::float as p from consumption where id = $1', [consumptionId]))[0].p,
    ).toBe(12);
  });
});

describe('diesel and internal withdrawals', () => {
  it('internal dispense requires purpose and cost centre', async () => {
    const tank = await containerOf('DIESEL');
    const res = await push('monteur-wild', 'ConsumeItem', {
      itemId: tank.item_id,
      storageLocationId: ids.tank,
      containerId: tank.id,
      quantity: 80,
    });
    expect(res.body.results[0]).toMatchObject({ result: 'rejected', reason: 'Ungültige Daten im Befehl' });
  });

  it('service van refuel with meter readings → item journal line with cost centre after approval', async () => {
    const tank = await containerOf('DIESEL');
    const id = randomUUID();
    const res = await push(
      'monteur-wild',
      'ConsumeItem',
      {
        itemId: tank.item_id,
        storageLocationId: ids.tank,
        containerId: tank.id,
        quantity: 80,
        internalPurpose: 'SERVICEWAGEN',
        costCenter: 'KST4711',
        meterBefore: 1000,
        meterAfter: 1050,
      },
      id,
    );
    expect(res.body.results[0].result).toBe('applied');
    expect(res.body.results[0].warnings[0]).toContain('Zählerstände');
    await api(app)
      .post('/v1/approvals/consumptions')
      .set(as('meister-wild'))
      .send({ ids: [id] })
      .expect(200);
    await worker.runOnce();
    const j = state.tables.itemJournalLines.find((l) => l.itemNumber === 'DIESEL' && l.quantity === 80);
    expect(j).toMatchObject({
      entryType: 'Negative Adjmt.',
      locationCode: 'WILD-TANK',
      shortcutDimension1Code: 'KST4711',
      journalTemplateName: 'ARTIKEL',
    });
  });
});

describe('stock warnings and conflicts', () => {
  it('falling below the minimum notifies Meister and Lager once', async () => {
    const ibc = await containerOf('ADBLUE');
    const s = await stock('ADBLUE', 'WILD');
    const take = s.bc - s.pending - Number(ibc.min_stock) + 1;
    await push('monteur-wild', 'ConsumeItem', {
      orderId: ids.order,
      itemId: ibc.item_id,
      storageLocationId: ids.wh,
      containerId: ibc.id,
      quantity: take,
    }).expect(200);
    await push('monteur-wild', 'ConsumeItem', {
      orderId: ids.order,
      itemId: ibc.item_id,
      storageLocationId: ids.wh,
      containerId: ibc.id,
      quantity: 1,
    }).expect(200);
    const n = await q("select user_id from notification where kind = 'MIN_STOCK' and body like 'AdBlue%'");
    expect(n.map((r) => r.user_id).sort()).toEqual([ids['meister-wild'], ids['lager-wild']].sort());
    const w = await api(app)
      .get(`/v1/stock/warnings?locationId=${(await q("select id from location where code='WILD'"))[0].id}`)
      .set(as('lager-wild'));
    expect(w.body.some((x: { itemNumber: string }) => x.itemNumber === 'ADBLUE')).toBe(true);
  });

  it('taking more than available is accepted but flagged as conflict', async () => {
    const it = (await q("select id from item where number = 'X548.880.400'"))[0];
    const s = await stock('X548.880.400', 'WILD');
    const res = await push('monteur-wild', 'ConsumeItem', {
      orderId: ids.order,
      itemId: it.id,
      storageLocationId: ids.wh,
      quantity: s.bc - s.pending + 3,
    });
    expect(res.body.results[0].result).toBe('applied');
    expect(
      (await q("select count(*)::int as n from notification where kind = 'STOCK_CONFLICT'"))[0].n,
    ).toBeGreaterThan(0);
  });

  it('a wrong withdrawal can be undone before approval; Meister can reject', async () => {
    const it = (await q("select id from item where number = 'F931.200.020.010'"))[0];
    const s0 = await stock('F931.200.020.010', 'WILD');
    const a = randomUUID();
    await push(
      'monteur-wild',
      'ConsumeItem',
      { orderId: ids.order, itemId: it.id, storageLocationId: ids.wh, quantity: 1 },
      a,
    );
    await push('monteur-wild', 'RemoveConsumption', { consumptionId: a });
    expect((await stock('F931.200.020.010', 'WILD')).pending).toBe(s0.pending);
    const b = randomUUID();
    await push(
      'monteur-wild',
      'ConsumeItem',
      { orderId: ids.order, itemId: it.id, storageLocationId: ids.wh, quantity: 2 },
      b,
    );
    await api(app)
      .post(`/v1/approvals/consumptions/${b}/reject`)
      .set(as('meister-wild'))
      .send({ reason: 'Falscher Filter' })
      .expect(200);
    expect((await stock('F931.200.020.010', 'WILD')).pending).toBe(s0.pending);
    const other = await api(app)
      .post('/v1/approvals/consumptions')
      .set(as('meister-clp'))
      .send({ ids: [b] });
    expect(other.status).toBe(404);
  });
});

describe('part requests (overnight from own warehouses, cutoff 17:00)', () => {
  it('creates the request with expected delivery, sets "Wartet auf Teile", notifies the Lager', async () => {
    const it = (await q("select id from item where number = 'F718.870.020.050'"))[0];
    const res = await push('monteur-wild', 'RequestPart', {
      orderId: ids.order,
      itemId: it.id,
      quantity: 2,
      sourceBcLocationCode: 'CLP',
      setWaitingForParts: true,
    });
    expect(res.body.results[0].result).toBe('applied');
    expect(res.body.results[0].warnings[0]).toMatch(/Lieferung voraussichtlich/);
    expect((await q('select app_status from service_order where id = $1', [ids.order]))[0].app_status).toBe(
      'WARTET_TEILE',
    );
    const list = await api(app)
      .get(`/v1/parts/requests?locationId=${(await q("select id from location where code='WILD'"))[0].id}`)
      .set(as('lager-wild'));
    const r = list.body.find((x: { orderId: string }) => x.orderId === ids.order);
    expect(r.expectedDelivery).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      (
        await q("select count(*)::int as n from notification where user_id = $1 and kind = 'PART_REQUEST'", [
          ids['lager-wild'],
        ])
      )[0].n,
    ).toBeGreaterThan(0);
    await api(app)
      .post(`/v1/parts/requests/${r.id}/state`)
      .set(as('lager-wild'))
      .send({ state: 'GELIEFERT' })
      .expect(200);
    expect(
      (
        await q(
          "select title from notification where user_id = $1 and kind = 'PART_REQUEST' order by created_at desc limit 1",
          [ids['monteur-wild']],
        )
      )[0].title,
    ).toContain('eingetroffen');
  });

  it('unknown part numbers become a "new item" request – never a new BC item', async () => {
    const res = await push('monteur-wild', 'RequestPart', {
      orderId: ids.order,
      newItemText: 'Dichtung Kabinentür',
      manufacturerPartNo: 'ACX123',
      quantity: 1,
    });
    expect(res.body.results[0].result).toBe('applied');
    expect(state.writeLog.some((w) => w.entitySet === 'items')).toBe(false);
  });

  it('another location cannot read the requests', async () => {
    const res = await api(app)
      .get(`/v1/parts/requests?locationId=${(await q("select id from location where code='WILD'"))[0].id}`)
      .set(as('meister-clp'));
    expect(res.status).toBe(403);
  });
});

describe('search, scan and catalogs', () => {
  it('finds by barcode, by normalised part number and by name; lists other warehouses', async () => {
    const byCode = await api(app).get('/v1/items/search?code=4012345100018').set(as('monteur-wild'));
    expect(byCode.body[0].number).toBe('F931.200.020.010');
    const byNo = await api(app).get('/v1/items/search?q=f931 200 020').set(as('monteur-wild'));
    expect(byNo.body.map((i: { number: string }) => i.number)).toContain('F931.200.020.010');
    const byName = await api(app).get('/v1/items/search?q=Luftfilter').set(as('monteur-wild'));
    expect(byName.body.length).toBeGreaterThanOrEqual(2);
    expect(
      byName.body[0].otherLocations.some((o: { locationCode: string }) => o.locationCode === 'CLP'),
    ).toBe(true);
  });

  it('resolves a part number pasted from the manufacturer catalog', async () => {
    const res = await api(app)
      .get(`/v1/items/resolve?text=${encodeURIComponent('Teilenummer: X548.880.400 – Keilrippenriemen')}`)
      .set(as('monteur-wild'));
    expect(res.body.partNo).toBe('X548.880.400');
    expect(res.body.items[0].number).toBe('X548.880.400');
  });

  it('offers the AGCO catalog as deep link only', async () => {
    const res = await api(app).get('/v1/parts/catalogs').set(as('monteur-wild'));
    expect(res.body.catalogs[0]).toMatchObject({ id: 'agco' });
  });
});
