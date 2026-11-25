/** Catalog hand-back (E-80): session with return address, OCI cart posted back, picked up by the own app only. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, tokenFor } from './helpers.js';

let app: NestExpressApplication;
let admin: pg.Client;
const CATALOGS = [
  {
    id: 'agco',
    label: 'AGCO',
    brands: ['FENDT'],
    url: 'https://eme.apb.agcocorp.com/?DEALER=4711&HOOK_URL={HOOK_URL}',
    mode: 'iframe',
  },
  {
    id: 'grimme',
    label: 'Grimme',
    brands: ['GRIMME'],
    url: 'https://www.agroparts.com/ip40_grimme/',
    mode: 'popup',
  },
];

beforeAll(async () => {
  app = await createTestApp();
  admin = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await admin.connect();
  await admin.query(`delete from setting where key = 'partsCatalogs' and location_id is null`);
  await admin.query(`insert into setting (key, location_id, value) values ('partsCatalogs', null, $1)`, [
    JSON.stringify({ catalogs: CATALOGS }),
  ]);
});
afterAll(async () => {
  await admin.query(`delete from setting where key = 'partsCatalogs' and location_id is null`);
  await admin.end();
  await app.close();
});

describe('catalog hand-back (E-80)', () => {
  it('opens the catalog with a return address; the posted OCI cart reaches only the own app, once', async () => {
    const monteur = await tokenFor(app, 'monteur-wild');
    const other = await tokenFor(app, 'meister-wild');
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const [order] = (await admin.query(`select id from service_order order by bc_no limit 1`)).rows as Array<{
      id: string;
    }>;

    const list = await api(app).get('/v1/parts/catalogs').set(auth(monteur));
    expect(list.body.catalogs).toEqual([
      expect.objectContaining({ id: 'agco', handBack: true, url: null, mode: 'iframe' }),
      expect.objectContaining({
        id: 'grimme',
        handBack: false,
        url: 'https://www.agroparts.com/ip40_grimme/',
      }),
    ]);

    const s = await api(app)
      .post('/v1/parts/catalog-sessions')
      .set(auth(monteur))
      .send({ catalogId: 'agco', orderId: order!.id });
    expect(s.status).toBe(201);
    expect(s.body.handBack).toBe(true);
    const hook = decodeURIComponent(new URL(s.body.url).searchParams.get('HOOK_URL')!);
    expect(s.body.url.startsWith('https://eme.apb.agcocorp.com/?DEALER=4711&HOOK_URL=')).toBe(true);
    const path = new URL(hook).pathname;
    expect(path).toMatch(/^\/v1\/parts\/catalog-return\/[A-Za-z0-9_-]{20,}$/);

    await api(app).get('/v1/parts/shop-cart/inbox').set(auth(monteur)); // empty start
    const back = await api(app).post(path).type('form').send({
      'NEW_ITEM-VENDORMAT[1]': 'X548844266000',
      'NEW_ITEM-QUANTITY[1]': '1.000',
      'NEW_ITEM-DESCRIPTION[1]': 'O-RING',
      'NEW_ITEM-VENDORMAT[2]': 'F530200220390',
      'NEW_ITEM-QUANTITY[2]': '2',
    });
    expect(back.status).toBe(200);
    expect(back.text).toContain('2 Positionen an die Werkstatt-App übergeben');
    expect(back.headers['content-security-policy']).toContain("script-src 'nonce-");

    expect((await api(app).get('/v1/parts/shop-cart/inbox').set(auth(other))).body).toEqual({ carts: [] });
    // another order's parts page leaves the cart where it is
    expect(
      (
        await api(app)
          .get('/v1/parts/shop-cart/inbox?orderId=00000000-0000-4000-8000-000000000001')
          .set(auth(monteur))
      ).body,
    ).toEqual({ carts: [] });
    expect(
      (await api(app).get(`/v1/parts/shop-cart/inbox?orderId=${order!.id}`).set(auth(monteur))).body,
    ).toEqual({
      carts: [
        {
          orderId: order!.id,
          catalogId: 'agco',
          lines: [
            { partNo: 'X548844266000', quantity: 1, name: 'O-RING' },
            { partNo: 'F530200220390', quantity: 2, name: null },
          ],
        },
      ],
    });
    expect((await api(app).get('/v1/parts/shop-cart/inbox').set(auth(monteur))).body).toEqual({ carts: [] });

    // GET variant, and a forged address
    const viaGet = await api(app).get(`${path}?NEW_ITEM-VENDORMAT%5B1%5D=A1234&NEW_ITEM-QUANTITY%5B1%5D=3`);
    expect(viaGet.status).toBe(200);
    expect((await api(app).get('/v1/parts/shop-cart/inbox').set(auth(monteur))).body.carts[0].lines).toEqual([
      { partNo: 'A1234', quantity: 3, name: null },
    ]);
    const forged = await api(app)
      .post(`/v1/parts/catalog-return/${'x'.repeat(32)}`)
      .type('form')
      .send({});
    expect(forged.status).toBe(400);
    expect(forged.text).toContain('abgelaufen');
  });

  it('a catalog without hand-back opens its start page; unknown catalog → 404', async () => {
    const monteur = await tokenFor(app, 'monteur-wild');
    const s = await api(app)
      .post('/v1/parts/catalog-sessions')
      .set({ Authorization: `Bearer ${monteur}` })
      .send({ catalogId: 'grimme', orderId: null });
    expect(s.body).toEqual({ url: 'https://www.agroparts.com/ip40_grimme/', mode: 'popup', handBack: false });
    const x = await api(app)
      .post('/v1/parts/catalog-sessions')
      .set({ Authorization: `Bearer ${monteur}` })
      .send({ catalogId: 'claas', orderId: null });
    expect(x.status).toBe(404);
  });
});
