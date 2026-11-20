import { localTime } from '@schroeder/shared';

export const fmtMinutes = (minutes: number) => {
  // Clock ticks are coarse (15 s); never show negative values right after a start.
  const m = Math.max(0, minutes);
  return `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')} h`;
};
export const fmtTime = (iso: string, tz: string) => localTime(new Date(iso), tz);
export const fmtDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });

/** Full date with year (absences may span years): 01.03.2027 */
export const fmtDay = (date: string) => date.split('-').reverse().join('.');

/** Navigation deeplinks (PROMPT 5.2). Address only, no tracking parameters. */
export function navLinks(a: { street: string; postCode: string; city: string } | null) {
  if (!a) return null;
  const q = encodeURIComponent(`${a.street}, ${a.postCode} ${a.city}`);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    apple: `https://maps.apple.com/?daddr=${q}`,
  };
}

export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
