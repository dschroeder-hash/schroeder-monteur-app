/** Time-zone helpers based on Intl (no dependency). All locations use Europe/Berlin today, but the zone is per location. */

const dtf = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = dtf.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtf.set(tz, f);
  }
  return f;
}

function parts(d: Date, tz: string) {
  const p = Object.fromEntries(
    fmt(tz)
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second! };
}

/** Local calendar date (YYYY-MM-DD) of an instant in the given zone. */
export function localDate(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Local wall-clock time HH:mm of an instant. */
export function localTime(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

/** Offset of the zone at instant d in minutes (e.g. +60 for CET, +120 for CEST). */
export function zoneOffsetMinutes(d: Date, tz: string): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
}

/** Converts a local date + wall-clock time in `tz` to the UTC instant (DST-safe). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi, s = 0] = time.split(':').map(Number) as [number, number, number?];
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = zoneOffsetMinutes(new Date(guess), tz);
  let result = guess - off * 60_000;
  // Second pass handles instants close to a DST change.
  off = zoneOffsetMinutes(new Date(result), tz);
  result = guess - off * 60_000;
  return new Date(result);
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
