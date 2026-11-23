/** Monteure see only their own data; Meister only their location. Checked via API and directly against RLS. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, persona, tokenFor } from '../helpers.js';

let app: NestExpressApplication;
let owner: pg.Client;
const ids = new Map<string, string>();

beforeAll(async () => {
  app = await createTestApp();
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  const users = await owner.query<{ id: string; entra_oid: string }>('select id, entra_oid from app_user');
  for (const p of ['monteur-wild', 'monteur2-wild', 'monteur-clp', 'meister-wild', 'meister-clp'])
    ids.set(p, users.rows.find((u) => u.entra_oid === persona(p).oid)!.id);
});
afterAll(async () => {
  await owner.end();
  await app.close();
});

async function ordersAssignedTo(userId: string): Promise<string[]> {
  const r = await owner.query<{ order_id: string }>(
    'select distinct order_id from assignment where user_id = $1 and cancelled_at is null',
    [userId],
  );
  return r.rows.map((x) => x.order_id);
}

/**
 * What RLS lets a Monteur see: orders assigned to him plus orders he has stamped on (an assignment may have been
 * cancelled later, e.g. by the BC sync – the own times stay visible).
 */
async function ordersVisibleTo(userId: string): Promise<string[]> {
  const r = await owner.query<{ order_id: string }>(
    `select order_id from assignment where user_id = $1 and cancelled_at is null
     union select order_id from time_entry where user_id = $1 and order_id is not null`,
    [userId],
  );
  return r.rows.map((x) => x.order_id);
}

describe('API: Monteur sees only own orders', () => {
  it('list contains exactly the orders assigned to him', async () => {
    const t = await tokenFor(app, 'monteur-wild');
    const res = await api(app).get('/v1/orders').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    const expected = await ordersAssignedTo(ids.get('monteur-wild')!);
    expect(expected.length).toBeGreaterThan(0);
    expect(res.body.map((o: { id: string }) => o.id).sort()).toEqual(expected.sort());
    // Assignments returned are only his own, even on shared orders.
    for (const o of res.body) for (const a of o.assignments) expect(a.userId).toBe(ids.get('monteur-wild'));
  });

  it("cannot read a colleague's order (404, not 403)", async () => {
    const own = new Set(await ordersAssignedTo(ids.get('monteur-wild')!));
    const foreign = (await ordersAssignedTo(ids.get('monteur2-wild')!)).find((id) => !own.has(id))!;
    const t = await tokenFor(app, 'monteur-wild');
    const res = await api(app).get(`/v1/orders/${foreign}`).set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(404);
  });

  it('cannot read orders of another location', async () => {
    const clpOrder = (await ordersAssignedTo(ids.get('monteur-clp')!))[0]!;
    const t = await tokenFor(app, 'monteur-wild');
    expect((await api(app).get(`/v1/orders/${clpOrder}`).set('Authorization', `Bearer ${t}`)).status).toBe(
      404,
    );
  });

  it('cannot use the location view', async () => {
    const t = await tokenFor(app, 'monteur-wild');
    expect((await api(app).get('/v1/orders?view=location').set('Authorization', `Bearer ${t}`)).status).toBe(
      403,
    );
  });
});

describe('API: Meister is limited to his location', () => {
  it('location view returns only WILD orders', async () => {
    const t = await tokenFor(app, 'meister-wild');
    const res = await api(app).get('/v1/orders?view=location').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    const wild = (await owner.query<{ id: string }>("select id from location where code = 'WILD'")).rows[0]!
      .id;
    expect(res.body.length).toBeGreaterThan(10);
    expect(res.body.every((o: { locationId: string }) => o.locationId === wild)).toBe(true);
  });

  it('cannot request another location', async () => {
    const clp = (await owner.query<{ id: string }>("select id from location where code = 'CLP'")).rows[0]!.id;
    const t = await tokenFor(app, 'meister-wild');
    expect(
      (await api(app).get(`/v1/orders?view=location&locationId=${clp}`).set('Authorization', `Bearer ${t}`))
        .status,
    ).toBe(403);
    const clpOrder = (await ordersAssignedTo(ids.get('monteur-clp')!))[0]!;
    expect((await api(app).get(`/v1/orders/${clpOrder}`).set('Authorization', `Bearer ${t}`)).status).toBe(
      404,
    );
  });

  it('location grant without Entra role Meister gives no Meister rights', async () => {
    // monteur-wild token with forged extra location grant in DB but no Meister role → still Monteur.
    await owner.query(
      "insert into user_location (user_id, location_id, role) select $1, id, 'MEISTER' from location where code = 'WILD'",
      [ids.get('monteur-wild')],
    );
    try {
      const t = await tokenFor(app, 'monteur-wild');
      expect(
        (await api(app).get('/v1/orders?view=location').set('Authorization', `Bearer ${t}`)).status,
      ).toBe(403);
    } finally {
      await owner.query("delete from user_location where user_id = $1 and role = 'MEISTER'", [
        ids.get('monteur-wild'),
      ]);
    }
  });
});

describe('RLS: database enforces isolation independently of the API code', () => {
  async function asUser(userId: string | null, roles: string, q: string): Promise<number> {
    const c = new pg.Client({ connectionString: process.env.TEST_API_DATABASE_URL });
    await c.connect();
    try {
      await c.query('begin');
      if (userId)
        await c.query("select set_config('app.user_id', $1, true), set_config('app.roles', $2, true)", [
          userId,
          roles,
        ]);
      const r = await c.query(q);
      await c.query('rollback');
      return r.rowCount ?? 0;
    } finally {
      await c.end();
    }
  }

  it('without session context no personal data is visible', async () => {
    expect(await asUser(null, '', 'select * from service_order')).toBe(0);
    expect(await asUser(null, '', 'select * from assignment')).toBe(0);
  });

  it('a Monteur sees only orders assigned to him even with an unfiltered query', async () => {
    const id = ids.get('monteur-wild')!;
    const expected = (await ordersVisibleTo(id)).length;
    expect(await asUser(id, 'Werkstatt.Monteur', 'select * from service_order')).toBe(expected);
    const ownAssignments = (await owner.query('select 1 from assignment where user_id = $1', [id])).rowCount;
    expect(await asUser(id, 'Werkstatt.Monteur', 'select * from assignment')).toBe(ownAssignments);
  });

  it('claiming the Meister role in the session without a location grant shows nothing extra', async () => {
    const id = ids.get('monteur-wild')!;
    const expected = (await ordersVisibleTo(id)).length;
    expect(await asUser(id, 'Werkstatt.Meister,Werkstatt.Admin', 'select * from service_order')).toBe(
      expected,
    );
  });

  it('the API login cannot rewrite raw stamp events or the audit log', async () => {
    const c = new pg.Client({ connectionString: process.env.TEST_API_DATABASE_URL });
    await c.connect();
    try {
      await expect(c.query('update audit_log set reason = null')).rejects.toThrow(/permission denied/);
      await expect(c.query('delete from stamp_event')).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });
});
