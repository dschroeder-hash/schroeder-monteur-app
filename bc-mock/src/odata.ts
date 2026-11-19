/**
 * Minimal OData v4 query support as used by the BC connector:
 *  $filter: comparisons (eq, ne, gt, ge, lt, le) joined by `and`; values: 'string', number, true/false, ISO datetime literal
 *  $top, $skip, $orderby (single field asc/desc)
 * Anything else results in a BC-like 400 error so connector mistakes surface in tests.
 */
import type { Row } from './seed.js';

export class ODataError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Op = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le';
interface Clause {
  field: string;
  op: Op;
  value: string | number | boolean | null;
}

const CLAUSE =
  /^\s*([A-Za-z][A-Za-z0-9]*)\s+(eq|ne|gt|ge|lt|le)\s+('(?:[^']|'')*'|-?\d+(?:\.\d+)?|true|false|null|\d{4}-\d{2}-\d{2}(?:T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))?)\s*$/;

export function parseFilter(filter: string): Clause[] {
  if (!filter.trim()) return [];
  if (/\s+or\s+/i.test(filter) || /[()]/.test(filter))
    throw new ODataError(400, 'BadRequest_NotSupported', `Filter not supported by mock: ${filter}`);
  return filter.split(/\s+and\s+/).map((part) => {
    const m = CLAUSE.exec(part);
    if (!m) throw new ODataError(400, 'BadRequest', `Invalid filter clause: ${part}`);
    const [, field, op, raw] = m as unknown as [string, string, Op, string];
    let value: Clause['value'];
    if (raw.startsWith("'")) value = raw.slice(1, -1).replace(/''/g, "'");
    else if (raw === 'true' || raw === 'false') value = raw === 'true';
    else if (raw === 'null') value = null;
    else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) value = raw;
    else value = Number(raw);
    return { field, op, value };
  });
}

function compare(a: unknown, b: Clause['value']): number {
  if (
    typeof a === 'string' &&
    typeof b === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(a) &&
    /^\d{4}-\d{2}-\d{2}T/.test(b)
  )
    return Date.parse(a) - Date.parse(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function matches(row: Row, clauses: Clause[]): boolean {
  return clauses.every(({ field, op, value }) => {
    if (!(field in row))
      throw new ODataError(400, 'BadRequest_PropertyNotFound', `Could not find a property named '${field}'.`);
    const v = row[field];
    if (op === 'eq') return value === null ? v === null : v === value || compare(v, value) === 0;
    if (op === 'ne') return value === null ? v !== null : compare(v, value) !== 0;
    const c = compare(v, value);
    return op === 'gt' ? c > 0 : op === 'ge' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
  });
}

export interface QueryOptions {
  $filter?: string;
  $top?: string;
  $skip?: string;
  $orderby?: string;
}

export function applyQuery(rows: Row[], q: QueryOptions): Row[] {
  let out = rows.filter((r) => matches(r, parseFilter(q.$filter ?? '')));
  if (q.$orderby) {
    const [field, dir = 'asc'] = q.$orderby.trim().split(/\s+/) as [string, string?];
    out = [...out].sort((a, b) => compare(a[field], b[field] as Clause['value']) * (dir === 'desc' ? -1 : 1));
  }
  const skip = q.$skip ? Number(q.$skip) : 0;
  const top = q.$top ? Number(q.$top) : undefined;
  if (Number.isNaN(skip) || (top !== undefined && Number.isNaN(top)))
    throw new ODataError(400, 'BadRequest', 'Invalid paging');
  return out.slice(skip, top === undefined ? undefined : skip + top);
}
