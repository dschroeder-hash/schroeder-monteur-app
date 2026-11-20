import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { EMPTY_GUID, endpoints, type EndpointName } from '@schroeder/bc-contract';
import { applyQuery, ODataError, type QueryOptions } from './odata.js';
import { buildSeed, SEED_COMPANY, type Row, type Tables } from './seed.js';

export interface MockOptions {
  /** Reference time for the seed (tests pass a fixed date). */
  now?: Date;
  /** Page size before @odata.nextLink is emitted (BC default is 20,000; small value exercises paging). */
  pageSize?: number;
  /** Require a bearer token like BC does. */
  requireAuth?: boolean;
  logger?: boolean;
}

interface Subscription {
  subscriptionId: string;
  notificationUrl: string;
  resource: string;
  clientState: string;
  expirationDateTime: string;
}

interface FailureInjection {
  remaining: number;
  status: number;
  code: string;
  /** Only fail requests whose path contains this string. */
  pathContains?: string;
}

const PATH =
  /^\/api\/(v2\.0|schroeder\/werkstatt\/v1\.0)\/companies\(([0-9a-f-]{36})\)\/([A-Za-z]+)(?:\(([0-9a-f-]{36})\))?$/;

/** Fields used to resolve the line number sequence per document for line tables. */
const LINE_TABLES: Partial<Record<EndpointName, string>> = {
  serviceLines: 'documentNumber',
  serviceCommentLines: 'documentNumber',
  resourceJournalLines: 'journalBatchName',
  itemJournalLines: 'journalBatchName',
};

/** BC table numbers (for the deleted-records log). */
const TABLE_NO: Partial<Record<EndpointName, number>> = {
  serviceOrders: 5900,
  serviceOrderItems: 5901,
  serviceLines: 5902,
  serviceOrderAllocations: 5950,
  serviceItems: 5940,
  employeeAbsences: 5207,
};

export class MockState {
  tables!: Tables;
  versions = new Map<string, number>();
  subscriptions: Subscription[] = [];
  failures: FailureInjection[] = [];
  /** Every write request received (for assertions in contract tests). */
  writeLog: Array<{ method: string; entitySet: string; body: unknown; status: number }> = [];
  private seq = 1;

  constructor(private readonly now?: Date) {
    this.reset();
  }

  reset() {
    this.tables = buildSeed(this.now);
    this.versions.clear();
    this.subscriptions = [];
    this.failures = [];
    this.writeLog = [];
  }

  etag(row: Row): string {
    const id = String(row.id ?? row.itemId);
    return `W/"${Buffer.from(`${id}:${this.versions.get(id) ?? 1}`).toString('base64')}"`;
  }

  /** Marks a record as modified (new lastModifiedDateTime, new ETag). */
  touch(row: Row) {
    const id = String(row.id ?? row.itemId);
    this.versions.set(id, (this.versions.get(id) ?? 1) + 1);
    // Ensure strictly increasing timestamps even within the same millisecond.
    row.lastModifiedDateTime = new Date(Date.now() + this.seq++).toISOString();
  }

  nextEntryNo() {
    return this.seq++;
  }
}

function bcError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply
    .status(status)
    .send({ error: { code, message: `${message}  CorrelationId:  ${randomUUID()}.` } });
}

export function buildMockServer(opts: MockOptions = {}): { app: FastifyInstance; state: MockState } {
  const state = new MockState(opts.now);
  const pageSize = opts.pageSize ?? 1000;
  const app = Fastify({ logger: opts.logger ?? false });
  // Entra ID token requests are form-encoded.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  const notify = async (entitySet: string, row: Row, changeType: 'created' | 'updated' | 'deleted') => {
    for (const s of state.subscriptions.filter((x) => x.resource.endsWith(`/${entitySet}`))) {
      const body = {
        value: [
          {
            subscriptionId: s.subscriptionId,
            clientState: s.clientState,
            expirationDateTime: s.expirationDateTime,
            resource: `${s.resource}(${String(row.id)})`,
            changeType,
            lastModifiedDateTime: row.lastModifiedDateTime,
          },
        ],
      };
      fetch(s.notificationUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    }
  };

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/__mock') || req.url.startsWith('/oauth2') || req.url.startsWith('/health'))
      return;
    if (opts.requireAuth !== false && !/^Bearer\s+\S+/.test(req.headers.authorization ?? ''))
      return bcError(reply, 401, 'Unauthorized', 'The credentials provided are incorrect');
    const f = state.failures.find(
      (x) => x.remaining > 0 && (!x.pathContains || req.url.includes(x.pathContains)),
    );
    if (f) {
      f.remaining--;
      if (f.status === 429) reply.header('Retry-After', '1');
      return bcError(reply, f.status, f.code, 'Injected failure');
    }
  });

  // ---- OAuth2 client credentials (Entra ID stand-in) ----
  app.post<{ Body: Record<string, string> }>('/oauth2/token', async (req, reply) => {
    if (req.body?.grant_type !== 'client_credentials' || !req.body.client_id)
      return reply
        .status(400)
        .send({ error: 'invalid_request', error_description: 'client_credentials expected' });
    return {
      token_type: 'Bearer',
      expires_in: 3599,
      access_token: `mock.${randomUUID()}`,
    };
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // ---- Mock control endpoints (tests / dev) ----
  app.post('/__mock/reset', async () => {
    state.reset();
    return { ok: true };
  });
  app.post<{ Body: FailureInjection }>('/__mock/failures', async (req) => {
    state.failures.push({ ...req.body });
    return { ok: true };
  });
  app.get('/__mock/writes', async () => state.writeLog);
  /** Simulate a change made by a BC user (e.g. dispatcher changes an order). */
  app.post<{ Body: { entitySet: EndpointName; id: string; patch: Row } }>(
    '/__mock/change',
    async (req, reply) => {
      const rows = state.tables[req.body.entitySet];
      const row = rows?.find((r) => r.id === req.body.id);
      if (!row) return bcError(reply, 404, 'NotFound', 'record not found');
      Object.assign(row, req.body.patch);
      state.touch(row);
      await notify(req.body.entitySet, row, 'updated');
      return row;
    },
  );
  /** Simulate deletion in BC (e.g. fully invoiced service order). */
  app.post<{ Body: { entitySet: EndpointName; id: string } }>('/__mock/delete', async (req, reply) => {
    const rows = state.tables[req.body.entitySet];
    const idx = rows?.findIndex((r) => r.id === req.body.id) ?? -1;
    if (idx < 0) return bcError(reply, 404, 'NotFound', 'record not found');
    const [row] = rows.splice(idx, 1);
    state.tables.deletedRecords.push({
      id: randomUUID(),
      tableNumber: TABLE_NO[req.body.entitySet] ?? 0,
      recordSystemId: req.body.id,
      deletedAt: new Date().toISOString(),
    });
    await notify(req.body.entitySet, row!, 'deleted');
    return { ok: true };
  });

  // ---- Companies ----
  app.get('/api/v2.0/companies', async () => ({ value: state.tables.companies }));
  app.get('/api/schroeder/werkstatt/v1.0/companies', async () => ({ value: state.tables.companies }));

  // ---- Webhook subscriptions (BC API v2.0 /subscriptions) ----
  app.post<{ Body: { notificationUrl: string; resource: string; clientState?: string } }>(
    '/api/v2.0/subscriptions',
    async (req, reply) => {
      const token = randomUUID();
      // BC performs a validation handshake and expects the token echoed back.
      const res = await fetch(`${req.body.notificationUrl}?validationToken=${token}`, {
        method: 'POST',
      }).catch(() => null);
      const echoed = res && res.ok ? (await res.text()).trim() : null;
      if (echoed !== token)
        return bcError(
          reply,
          400,
          'Internal_ValidationFailed',
          'The notification URL did not echo the validation token',
        );
      const sub: Subscription = {
        subscriptionId: randomUUID().replace(/-/g, ''),
        notificationUrl: req.body.notificationUrl,
        resource: req.body.resource,
        clientState: req.body.clientState ?? '',
        expirationDateTime: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      };
      state.subscriptions.push(sub);
      return reply.status(201).send(sub);
    },
  );
  app.get('/api/v2.0/subscriptions', async () => ({ value: state.subscriptions }));

  // ---- Generic entity handler ----
  const handle = async (
    method: string,
    url: string,
    body: unknown,
    headers: Record<string, string | undefined>,
  ) => {
    const u = new URL(url, 'http://mock');
    const m = PATH.exec(u.pathname);
    if (!m)
      throw new ODataError(
        404,
        'BadRequest_ResourceNotFound',
        `Resource not found for the segment '${u.pathname}'.`,
      );
    const [, family, companyId, entitySet, id] = m as unknown as [
      string,
      string,
      string,
      string,
      string | undefined,
    ];
    if (companyId !== SEED_COMPANY.id)
      throw new ODataError(404, 'BadRequest_ResourceNotFound', 'Company not found');
    const name = Object.keys(endpoints).find((k) => endpoints[k as EndpointName].entitySet === entitySet) as
      EndpointName | undefined;
    const def = name ? endpoints[name] : undefined;
    const expectedFamily = def?.family === 'standard' ? 'v2.0' : 'schroeder/werkstatt/v1.0';
    if (!name || !def || family !== expectedFamily)
      throw new ODataError(
        404,
        'BadRequest_ResourceNotFound',
        `Resource not found for the segment '${entitySet}'.`,
      );
    const rows = state.tables[name];

    if (method === 'GET') {
      if (id) {
        const row = rows.find((r) => r.id === id);
        if (!row) throw new ODataError(404, 'Internal_RecordNotFound', `The ${entitySet} does not exist.`);
        return { status: 200, body: { '@odata.etag': state.etag(row), ...row } };
      }
      const q = Object.fromEntries(u.searchParams) as QueryOptions & { $skiptoken?: string };
      const offset = Number(q.$skiptoken ?? 0);
      const all = applyQuery(rows, { ...q, $skip: undefined, $top: undefined });
      const skip = Number(q.$skip ?? 0);
      const limit = q.$top ? Number(q.$top) : Infinity;
      const window = all.slice(skip, skip + Math.min(limit, all.length));
      const page = window.slice(offset, offset + pageSize);
      const res: Record<string, unknown> = {
        value: page.map((r) => ({ '@odata.etag': state.etag(r), ...r })),
      };
      if (offset + pageSize < window.length) {
        const next = new URL(u.toString());
        next.searchParams.set('$skiptoken', String(offset + pageSize));
        res['@odata.nextLink'] = next.pathname + next.search;
      }
      return { status: 200, body: res };
    }

    if (method === 'POST' && !id) {
      const createSchema = def.writable?.create;
      if (!createSchema)
        throw new ODataError(405, 'BadRequest_MethodNotAllowed', `'POST' is not allowed on ${entitySet}`);
      const parsed = createSchema.safeParse(body);
      if (!parsed.success)
        throw new ODataError(
          400,
          'BadRequest',
          `Invalid request body: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
        );
      const data = parsed.data as Row;
      // Idempotency: same Monteur App Id returns the existing record (AL page behaviour).
      if (data.monteurAppId && data.monteurAppId !== EMPTY_GUID) {
        const existing = rows.find((r) => r.monteurAppId === data.monteurAppId);
        if (existing) return { status: 201, body: { '@odata.etag': state.etag(existing), ...existing } };
      }
      if (name === 'employeeAbsences') {
        // Same validation as BC: employee and cause of absence must exist.
        if (!state.tables.employees.some((e) => e.number === data.employeeNumber))
          throw new ODataError(
            400,
            'Internal_RecordNotFound',
            `The Employee does not exist. Identification fields and values: No.='${String(data.employeeNumber)}'`,
          );
        if (!state.tables.causesOfAbsence.some((c) => c.code === data.causeOfAbsenceCode))
          throw new ODataError(
            400,
            'Internal_RecordNotFound',
            `The Cause of Absence does not exist. Identification fields and values: Code='${String(data.causeOfAbsenceCode)}'`,
          );
      }
      if (
        name === 'serviceLines' ||
        name === 'serviceCommentLines' ||
        name === 'serviceOrderAllocations' ||
        name === 'serviceOrderAttachments'
      ) {
        const so = state.tables.serviceOrders.find((o) => o.number === data.documentNumber);
        if (!so)
          throw new ODataError(
            400,
            'Internal_RecordNotFound',
            `Service Header Order ${String(data.documentNumber)} does not exist.`,
          );
        if (so.status === 'Finished' && name === 'serviceLines')
          throw new ODataError(
            400,
            'Application_DialogException',
            'Status must not be Finished in Service Header.',
          );
      }
      if (name === 'serviceLines') {
        const ref =
          data.type === 'Item'
            ? state.tables.items.find((i) => i.number === data.number)
            : state.tables.resources.find((r) => r.number === data.number);
        if (!ref)
          throw new ODataError(
            400,
            'Internal_RecordNotFound',
            `${String(data.type)} ${String(data.number)} does not exist.`,
          );
      }
      const row: Row = { id: randomUUID(), lastModifiedDateTime: new Date().toISOString(), ...data };
      const lineKey = LINE_TABLES[name];
      if (lineKey) {
        const max = Math.max(
          0,
          ...rows.filter((r) => r[lineKey] === data[lineKey]).map((r) => Number(r.lineNumber)),
        );
        row.lineNumber = max + 10000;
      }
      if (name === 'serviceLines') {
        row.quantityShipped = 0;
        row.quantityConsumed = 0;
        row.quantityInvoiced = 0;
        row.description ||= String(
          (data.type === 'Item'
            ? state.tables.items.find((i) => i.number === data.number)?.displayName
            : state.tables.resources.find((r) => r.number === data.number)?.name) ?? '',
        );
        row.workTypeCode ??= '';
      }
      if (name === 'serviceOrderAllocations') row.status = 'Active';
      if (name === 'employeeAbsences') row.entryNumber = state.nextEntryNo();
      rows.push(row);
      state.touch(row);
      await notify(entitySet, row, 'created');
      return { status: 201, body: { '@odata.etag': state.etag(row), ...row } };
    }

    if (method === 'PATCH' && id) {
      const patchSchema = def.writable?.patch;
      if (!patchSchema)
        throw new ODataError(405, 'BadRequest_MethodNotAllowed', `'PATCH' is not allowed on ${entitySet}`);
      const row = rows.find((r) => r.id === id);
      if (!row) throw new ODataError(404, 'Internal_RecordNotFound', `The ${entitySet} does not exist.`);
      const ifMatch = headers['if-match'];
      if (!ifMatch)
        throw new ODataError(
          428,
          'Request_EntityChanged',
          'Could not save because of a missing If-Match header.',
        );
      if (ifMatch !== '*' && ifMatch !== state.etag(row))
        throw new ODataError(412, 'Request_EntityChanged', 'Another user has already changed the record.');
      const parsed = patchSchema.safeParse(body);
      if (!parsed.success) throw new ODataError(400, 'BadRequest', parsed.error.message);
      Object.assign(row, parsed.data);
      state.touch(row);
      await notify(entitySet, row, 'updated');
      return { status: 200, body: { '@odata.etag': state.etag(row), ...row } };
    }

    if (method === 'DELETE' && id) {
      if (!def.writable?.delete)
        throw new ODataError(
          405,
          'BadRequest_MethodNotAllowed',
          'Deletes are not allowed for the Monteur-App',
        );
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) throw new ODataError(404, 'Internal_RecordNotFound', `The ${entitySet} does not exist.`);
      const [row] = rows.splice(idx, 1);
      state.tables.deletedRecords.push({
        id: randomUUID(),
        tableNumber: TABLE_NO[name] ?? 0,
        recordSystemId: id,
        deletedAt: new Date().toISOString(),
      });
      await notify(entitySet, row!, 'deleted');
      return { status: 204, body: undefined };
    }
    if (method === 'DELETE')
      throw new ODataError(405, 'BadRequest_MethodNotAllowed', 'Deletes are not allowed for the Monteur-App');
    throw new ODataError(405, 'BadRequest_MethodNotAllowed', `'${method}' is not allowed`);
  };

  const run = async (
    method: string,
    url: string,
    body: unknown,
    headers: Record<string, string | undefined>,
  ) => {
    try {
      const res = await handle(method, url, body, headers);
      if (method !== 'GET')
        state.writeLog.push({ method, entitySet: url.split('/').pop() ?? '', body, status: res.status });
      return res;
    } catch (e) {
      if (e instanceof ODataError) {
        if (method !== 'GET')
          state.writeLog.push({ method, entitySet: url.split('/').pop() ?? '', body, status: e.status });
        return { status: e.status, body: { error: { code: e.code, message: e.message } } };
      }
      throw e;
    }
  };

  // ---- OData JSON $batch ----
  app.post<{
    Body: {
      requests: Array<{
        id: string;
        method: string;
        url: string;
        headers?: Record<string, string>;
        body?: unknown;
      }>;
    };
  }>('/api/:a/:b/:c/$batch', async (req) => {
    const prefix = req.url.replace(/\$batch.*$/, '');
    const responses = [];
    for (const r of req.body.requests) {
      const url = r.url.startsWith('/') ? r.url : prefix + r.url;
      const headers = Object.fromEntries(
        Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      );
      const res = await run(r.method.toUpperCase(), url, r.body, headers);
      responses.push({
        id: r.id,
        status: res.status,
        headers: { 'content-type': 'application/json' },
        body: res.body,
      });
    }
    return { responses };
  });
  app.route({
    method: ['GET', 'POST', 'PATCH', 'DELETE'],
    url: '/api/*',
    handler: async (req, reply) => {
      const headers = { 'if-match': req.headers['if-match'] as string | undefined };
      const res = await run(req.method, req.url, req.body, headers);
      return reply.status(res.status).send(res.body);
    },
  });

  return { app, state };
}
