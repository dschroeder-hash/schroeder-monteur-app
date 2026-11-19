/**
 * German public holidays per federal state (Bundesland, ISO 3166-2 suffix).
 * Small own implementation so it can run offline in the browser (ENTSCHEIDUNGEN E-22, revised in E-41).
 * Regional holidays that only apply to parts of a state (e.g. Mariä Himmelfahrt in parts of Bavaria,
 * Augsburger Friedensfest) are not included.
 */
export type Bundesland =
  | 'BW'
  | 'BY'
  | 'BE'
  | 'BB'
  | 'HB'
  | 'HH'
  | 'HE'
  | 'MV'
  | 'NI'
  | 'NW'
  | 'RP'
  | 'SL'
  | 'SN'
  | 'ST'
  | 'SH'
  | 'TH';

/** Easter Sunday (Gregorian, Meeus/Jones/Butcher). Returns YYYY-MM-DD. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const shift = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** Holidays of a year as map date → name. */
export function holidays(year: number, land: Bundesland): Map<string, string> {
  const e = easterSunday(year);
  const fixed = (md: string) => `${year}-${md}`;
  const list: Array<[string, string, Bundesland[] | 'ALL']> = [
    [fixed('01-01'), 'Neujahr', 'ALL'],
    [fixed('01-06'), 'Heilige Drei Könige', ['BW', 'BY', 'ST']],
    [fixed('03-08'), 'Internationaler Frauentag', ['BE', 'MV']],
    [shift(e, -2), 'Karfreitag', 'ALL'],
    [shift(e, 1), 'Ostermontag', 'ALL'],
    [fixed('05-01'), 'Tag der Arbeit', 'ALL'],
    [shift(e, 39), 'Christi Himmelfahrt', 'ALL'],
    [shift(e, 50), 'Pfingstmontag', 'ALL'],
    [shift(e, 60), 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']],
    [fixed('08-15'), 'Mariä Himmelfahrt', ['SL']],
    [fixed('09-20'), 'Weltkindertag', ['TH']],
    [fixed('10-03'), 'Tag der Deutschen Einheit', 'ALL'],
    [fixed('10-31'), 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']],
    [fixed('11-01'), 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']],
    [fixed('12-25'), '1. Weihnachtstag', 'ALL'],
    [fixed('12-26'), '2. Weihnachtstag', 'ALL'],
  ];
  // Buß- und Bettag: Wednesday before 23 November (Saxony).
  if (land === 'SN') {
    const nov23 = new Date(Date.UTC(year, 10, 23));
    const back = (nov23.getUTCDay() - 3 + 7) % 7 || 7;
    list.push([shift(`${year}-11-23`, -back), 'Buß- und Bettag', ['SN']]);
  }
  return new Map(list.filter(([, , l]) => l === 'ALL' || l.includes(land)).map(([d, n]) => [d, n]));
}

export function isHoliday(date: string, land: Bundesland): boolean {
  return holidays(Number(date.slice(0, 4)), land).has(date);
}

export function isWorkingDay(date: string, land: Bundesland): boolean {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !isHoliday(date, land);
}

export function nextWorkingDay(date: string, land: Bundesland): string {
  let d = shift(date, 1);
  while (!isWorkingDay(d, land)) d = shift(d, 1);
  return d;
}
