/**
 * Business Central connector (shared with the CRM later as @schroeder/bc-connector).
 *  - OAuth2 client credentials with token caching
 *  - OData paging (@odata.nextLink), delta queries via lastModifiedDateTime
 *  - Contract validation against @schroeder/bc-contract (after normalising BC blank values)
 *  - Retries with exponential backoff + jitter on 429/5xx/network errors (honours Retry-After)
 *  - Concurrency limit per client (BC allows ~5 concurrent requests per user and company)
 */
import { endpoints, entityPath, type EndpointName, type EntityOf } from '@schroeder/bc-contract';
import type { z } from 'zod';

export interface BcClientOptions {
  apiBaseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  companyId: string;
  maxConcurrency?: number;
  maxRetries?: number;
  /** Base delay for backoff in ms (tests use small values). */
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  validate?: boolean;
}

export class BcError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(`BC ${status} ${code}: ${message}`);
  }
}

export class BcContractError extends Error {}

const BLANK_DATE = '0001-01-01';

/** BC returns 0001-01-01 for blank dates and "_x0020_" for a blank option value. */
export function normalizeBcRecord(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('@odata.')) continue;
    if (v === BLANK_DATE || (typeof v === 'string' && v.startsWith('0001-01-01T'))) out[k] = null;
    else if (v === '_x0020_') out[k] = ' ';
    else out[k] = v;
  }
  return out;
}

class Semaphore {
  private queue: Array<() => void> = [];
  constructor(private free: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free === 0) await new Promise<void>((r) => this.queue.push(r));
    else this.free--;
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.free++;
    }
  }
}

export interface Written<T> {
  record: T;
  etag: string | undefined;
}

export class BcClient {
  private token?: { value: string; expiresAt: number };
  private readonly sem: Semaphore;
  private readonly fetch: typeof fetch;

  constructor(private readonly o: BcClientOptions) {
    this.sem = new Semaphore(o.maxConcurrency ?? 3);
    this.fetch = o.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.o.clientId,
      client_secret: this.o.clientSecret,
      scope: this.o.scope,
    });
    const res = await this.fetch(this.o.tokenUrl, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) throw new BcError(res.status, 'TokenError', 'could not acquire BC token', res.status >= 500);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async request(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ json: unknown; etag?: string }> {
    const max = this.o.maxRetries ?? 5;
    const base = this.o.backoffBaseMs ?? 500;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.sem.run(async () =>
          this.fetch(url, {
            method,
            headers: {
              authorization: `Bearer ${await this.accessToken()}`,
              accept: 'application/json',
              ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
              ...headers,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
          }),
        );
      } catch (e) {
        if (e instanceof BcError) throw e;
        if (attempt >= max)
          throw new BcError(0, 'NetworkError', e instanceof Error ? e.message : String(e), true);
        await sleep(backoff(attempt, base));
        continue;
      }
      if (res.status === 401 && attempt === 0) {
        this.token = undefined; // token revoked/rotated → retry once with a fresh token
        continue;
      }
      if (res.ok) {
        const text = await res.text();
        return { json: text ? JSON.parse(text) : null, etag: res.headers.get('etag') ?? undefined };
      }
      const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= max)
        throw new BcError(
          res.status,
          err.error?.code ?? 'Unknown',
          err.error?.message ?? res.statusText,
          retryable,
        );
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt, base));
    }
  }

  private url(name: EndpointName, suffix = ''): string {
    return `${this.o.apiBaseUrl.replace(/\/$/, '')}/${entityPath(name, this.o.companyId)}${suffix}`;
  }

  private parse<N extends EndpointName>(name: N, row: Record<string, unknown>): EntityOf<N> {
    const normalized = normalizeBcRecord(row);
    if (this.o.validate === false) return normalized as EntityOf<N>;
    const r = (endpoints[name].schema as z.ZodTypeAny).safeParse(normalized);
    if (!r.success) throw new BcContractError(`${name}: response violates contract: ${r.error.message}`);
    return r.data as EntityOf<N>;
  }

  /** Reads all pages. `filter` is an OData $filter expression. */
  async list<N extends EndpointName>(
    name: N,
    opts: { filter?: string; top?: number } = {},
  ): Promise<EntityOf<N>[]> {
    const params = new URLSearchParams();
    if (opts.filter) params.set('$filter', opts.filter);
    if (opts.top) params.set('$top', String(opts.top));
    let next: string | undefined = this.url(name, params.size ? `?${params.toString()}` : '');
    const out: EntityOf<N>[] = [];
    while (next) {
      const { json } = await this.request('GET', next);
      const page = json as { value: Record<string, unknown>[]; '@odata.nextLink'?: string };
      out.push(...page.value.map((r) => this.parse(name, r)));
      const link = page['@odata.nextLink'];
      next = link ? new URL(link, this.o.apiBaseUrl).toString() : undefined;
    }
    return out;
  }

  /** Delta read: records modified after `since` (with overlap to tolerate clock/commit skew). */
  async listModifiedSince<N extends EndpointName>(
    name: N,
    since: Date | null,
    overlapMs = 5000,
    extraFilter?: string,
  ): Promise<EntityOf<N>[]> {
    if (!endpoints[name].delta) throw new Error(`${name} does not support delta sync`);
    const parts = [] as string[];
    if (since) parts.push(`lastModifiedDateTime gt ${new Date(since.getTime() - overlapMs).toISOString()}`);
    if (extraFilter) parts.push(extraFilter);
    return this.list(name, { filter: parts.join(' and ') || undefined });
  }

  async get<N extends EndpointName>(name: N, id: string): Promise<Written<EntityOf<N>>> {
    const { json } = await this.request('GET', this.url(name, `(${id})`));
    const row = json as Record<string, unknown>;
    return { record: this.parse(name, row), etag: row['@odata.etag'] as string | undefined };
  }

  /** Idempotent create: the payload must carry `monteurAppId`; BC returns the existing record on replay. */
  async create<N extends EndpointName>(
    name: N,
    payload: Record<string, unknown>,
  ): Promise<Written<EntityOf<N>>> {
    const schema = endpoints[name].writable?.create;
    if (!schema) throw new Error(`${name} is not writable`);
    const body = schema.parse(payload);
    const { json } = await this.request('POST', this.url(name), body);
    const row = json as Record<string, unknown>;
    return { record: this.parse(name, row), etag: row['@odata.etag'] as string | undefined };
  }

  async patch<N extends EndpointName>(
    name: N,
    id: string,
    etag: string,
    payload: Record<string, unknown>,
  ): Promise<Written<EntityOf<N>>> {
    const schema = endpoints[name].writable?.patch;
    if (!schema) throw new Error(`${name} cannot be patched`);
    const { json } = await this.request('PATCH', this.url(name, `(${id})`), schema.parse(payload), {
      'if-match': etag,
    });
    const row = json as Record<string, unknown>;
    return { record: this.parse(name, row), etag: row['@odata.etag'] as string | undefined };
  }

  /** Deletes a record. A record that is already gone counts as deleted (idempotent retry). */
  async delete(name: EndpointName, id: string): Promise<void> {
    if (!endpoints[name].writable?.delete) throw new Error(`${name} cannot be deleted`);
    try {
      await this.request('DELETE', this.url(name, `(${id})`), undefined, { 'if-match': '*' });
    } catch (e) {
      if (e instanceof BcError && e.status === 404) return;
      throw e;
    }
  }
}

function backoff(attempt: number, base: number): number {
  return Math.min(base * 2 ** attempt, 60_000) * (0.5 + Math.random() / 2);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
