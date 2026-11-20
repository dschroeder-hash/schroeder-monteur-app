/** Photos to M-Files (E-73): one document per photo with a lookup to the machine object of the order. */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { MFilesClient } from '../src/mfiles/mfiles-client.js';
import { runMFilesPhotos } from '../src/mfiles/mfiles-photos.js';
import type { BlobStorage } from '../src/modules/files/blob-storage.js';

const created: Array<{
  props: Array<{ PropertyDef: number; TypedValue: Record<string, unknown> }>;
  size: number;
}> = [];
const uploads = new Map<number, number>();
let server: Server;
let base: string;
let owner: pg.Client;
let workerDb: ReturnType<typeof createDb>;
let machineNo: string;
let photoId: string;

const body = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const json = (status: number, v: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
    const b = await body(req);
    if (req.url === '/REST/server/authenticationtokens') return json(200, { Value: 'tok' });
    if (req.headers['x-authentication'] !== 'tok') return json(401, {});
    if (req.method === 'GET' && req.url?.startsWith('/REST/objects/101?p1050='))
      return json(200, {
        Items: decodeURIComponent(req.url.split('=')[1]!) === machineNo ? [{ ObjVer: { ID: 777 } }] : [],
      });
    if (req.method === 'POST' && req.url === '/REST/files') {
      const id = uploads.size + 1;
      uploads.set(id, b.length);
      return json(200, { UploadID: id, Size: b.length });
    }
    if (req.method === 'POST' && req.url === '/REST/objects/0') {
      const v = JSON.parse(b.toString()) as {
        PropertyValues: (typeof created)[number]['props'];
        Files: Array<{ UploadID: number }>;
      };
      created.push({ props: v.PropertyValues, size: uploads.get(v.Files[0]!.UploadID)! });
      return json(200, { ObjVer: { ID: 9000 + created.length } });
    }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  owner = new pg.Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await owner.connect();
  workerDb = createDb(process.env.TEST_WORKER_DATABASE_URL!, 2);
  const [o] = (
    await owner.query(
      `select o.id, o.bc_no, m.service_item_no, a.user_id from service_order o
       join service_order_item i on i.order_id = o.id join machine m on m.id = i.machine_id
       join assignment a on a.order_id = o.id limit 1`,
    )
  ).rows;
  machineNo = o.service_item_no;
  photoId = randomUUID();
  await owner.query('update photo set mfiles_attempts = 10 where mfiles_object_id is null'); // others are not part of this test
  await owner.query(
    `insert into photo (id, order_id, uploaded_by, category, blob_path, upload_state, captured_at)
     values ($1, $2, $3, 'TYPENSCHILD', 'p/test.jpg', 'UPLOADED', now())`,
    [photoId, o.id, o.user_id],
  );
});
afterAll(async () => {
  await workerDb.pool.end();
  await owner.end();
  server.close();
});

const client = () =>
  new MFilesClient({
    baseUrl: base,
    vaultGuid: '{00000000-0000-0000-0000-000000000000}',
    username: 'svc',
    password: 'x',
    machineObjectType: 101,
    machineKeyProperty: 1050,
    photoClass: 33,
    machineLookupProperty: 1051,
    orderNoProperty: 1052,
  });
const storage = { read: async () => Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]) } as unknown as BlobStorage;

it('creates a photo document on the machine object with the order number', async () => {
  const r = await runMFilesPhotos(workerDb.db, storage, client(), () => undefined);
  expect(r).toEqual({ sent: 1, failed: 0 });
  const doc = created[0]!;
  expect(doc.size).toBe(6);
  expect(doc.props.find((p) => p.PropertyDef === 1051)?.TypedValue).toMatchObject({
    Lookups: [{ Item: 777 }],
  });
  expect(doc.props.find((p) => p.PropertyDef === 100)?.TypedValue).toMatchObject({ Lookup: { Item: 33 } });
  const [row] = (
    await owner.query('select mfiles_object_id, mfiles_error from photo where id = $1', [photoId])
  ).rows;
  expect(row).toEqual({ mfiles_object_id: '9001', mfiles_error: null });
  // already sent → not sent again
  expect(await runMFilesPhotos(workerDb.db, storage, client(), () => undefined)).toEqual({
    sent: 0,
    failed: 0,
  });
});

it('keeps the error at the photo when the machine is unknown in M-Files', async () => {
  machineNo = 'nicht-vorhanden';
  await owner.query('update photo set mfiles_object_id = null where id = $1', [photoId]);
  const r = await runMFilesPhotos(workerDb.db, storage, client(), () => undefined);
  expect(r.failed).toBe(1);
  const [row] = (
    await owner.query('select mfiles_error, mfiles_attempts from photo where id = $1', [photoId])
  ).rows;
  expect(row.mfiles_error).toMatch(/nicht gefunden/);
  expect(row.mfiles_attempts).toBe(1);
});
