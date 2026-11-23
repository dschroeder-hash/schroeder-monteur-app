/** Bookmark "→ Werkstatt-App" (E-78): link token, push from the shop page, pick-up in the app. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, tokenFor } from './helpers.js';

const PAGE = [
  'AGCO-Teilenr. X548844266000',
  '1 X 2,32 € pro Stück',
  'AGCO-Teilenr.',
  'F531.200.020.010',
  '2 X 913,00 € pro Stück',
  'Empfohlene Artikel',
  'AGCO-Teilenr. X999000111222',
  '12,50 €',
].join('\n');

let app: NestExpressApplication;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('shop cart bookmark (E-78)', () => {
  it('push with the personal token lands in the own inbox only; a new link invalidates the old one', async () => {
    const monteur = await tokenFor(app, 'monteur-wild');
    const other = await tokenFor(app, 'meister-wild');
    const get = (t: string) => api(app).get('/v1/parts/shop-cart/inbox').set('Authorization', `Bearer ${t}`);
    const push = (token: string) => api(app).post('/v1/parts/shop-cart').send({ token, text: PAGE });
    const { token } = (await api(app).put('/v1/me/shop-cart-link').set('Authorization', `Bearer ${monteur}`))
      .body as { token: string };
    await get(monteur); // empty start

    const res = await push(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lines: 2 });

    expect((await get(other)).body).toEqual({ carts: [] });
    expect((await get(monteur)).body).toEqual({
      carts: [
        [
          { partNo: 'X548844266000', quantity: 1 },
          { partNo: 'F531.200.020.010', quantity: 2 },
        ],
      ],
    });
    expect((await get(monteur)).body).toEqual({ carts: [] }); // picked up

    await api(app).put('/v1/me/shop-cart-link').set('Authorization', `Bearer ${monteur}`);
    expect((await push(token)).status).toBe(400);
    expect((await push('x'.repeat(32))).status).toBe(400);
  });
});
