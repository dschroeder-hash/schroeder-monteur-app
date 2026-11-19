import { localDate, localTime } from '../time/tz.js';
import { isWorkingDay, nextWorkingDay, type Bundesland } from './holidays.js';

export interface DeliveryEstimate {
  /** Local date the part is expected at the location. */
  deliveryDate: string;
  /** Order was placed after the cutoff (or on a non-working day). */
  afterCutoff: boolean;
  /** "morgen", "übermorgen" or weekday + date – for the UI hint. */
  label: string;
}

/**
 * Overnight delivery from the group's own warehouses (PROMPT 1/5.5): ordered on a working day before the cutoff
 * (default 17:00 local) → next working day; otherwise one working day later.
 */
export function estimateDelivery(
  orderedAt: Date,
  tz: string,
  land: Bundesland,
  cutoff = '17:00',
): DeliveryEstimate {
  const day = localDate(orderedAt, tz);
  const beforeCutoff = localTime(orderedAt, tz) < cutoff && isWorkingDay(day, land);
  const processingDay = beforeCutoff ? day : nextWorkingDay(day, land);
  const deliveryDate = nextWorkingDay(processingDay, land);
  const diff = Math.round(
    (Date.parse(`${deliveryDate}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86_400_000,
  );
  const pretty = new Date(`${deliveryDate}T12:00:00Z`).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
  return {
    deliveryDate,
    afterCutoff: !beforeCutoff,
    label: diff === 1 ? `morgen (${pretty})` : diff === 2 ? `übermorgen (${pretty})` : pretty,
  };
}
