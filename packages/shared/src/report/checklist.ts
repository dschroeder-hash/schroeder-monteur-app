/**
 * Service checklists (E-67). The layout comes from the checklist template in Business Central; the app only needs
 * the items, their kind and whether they are required.
 */
export interface ChecklistItem {
  id: string;
  text: string;
  kind: 'check' | 'value' | 'text';
  unit?: string | null;
  required?: boolean;
  section?: string | null;
}
export interface ChecklistAnswer {
  state: 'OK' | 'NOK' | 'NA' | null;
  value: string | null;
  note: string;
}
export interface ChecklistTemplateDef {
  id: string;
  title: string;
  orderTypeCode: string | null;
  brand: string | null;
  locationId: string | null;
  items: ChecklistItem[];
}

const answered = (item: ChecklistItem, a: ChecklistAnswer | undefined) =>
  item.kind === 'check' ? !!a?.state : !!(a?.value ?? '').trim();

/** Required items not yet answered; a "not OK" needs a note (what was found / done). */
export function checklistMissing(items: ChecklistItem[], results: Record<string, ChecklistAnswer>): string[] {
  const missing: string[] = [];
  for (const item of items) {
    const a = results[item.id];
    if ((item.required ?? true) && !answered(item, a)) missing.push(item.text);
    else if (item.kind === 'check' && a?.state === 'NOK' && !a.note.trim())
      missing.push(`${item.text} (Bemerkung)`);
  }
  return missing;
}

/**
 * Template for an order: the most specific active one wins – location + order type + brand before location +
 * order type, before global ones. null if no template applies (no checklist needed).
 */
export function pickChecklistTemplate<T extends ChecklistTemplateDef>(
  templates: T[],
  order: { locationId: string; orderTypeCode: string; brand: string | null },
): T | null {
  const fits = templates.filter(
    (t) =>
      (!t.locationId || t.locationId === order.locationId) &&
      (!t.orderTypeCode || t.orderTypeCode === order.orderTypeCode) &&
      (!t.brand || t.brand.toUpperCase() === (order.brand ?? '').toUpperCase()),
  );
  const score = (t: T) => (t.locationId ? 4 : 0) + (t.orderTypeCode ? 2 : 0) + (t.brand ? 1 : 0);
  return fits.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** One BC comment text per answered item: "✓ Ölstand prüfen", "✗ Bremsen: Belag 2 mm – getauscht", "Reifendruck: 1,8 bar". */
export function checklistLines(items: ChecklistItem[], results: Record<string, ChecklistAnswer>): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const a = results[item.id];
    if (!a) continue;
    const note = a.note.trim() ? ` – ${a.note.trim()}` : '';
    if (item.kind === 'check' && a.state)
      lines.push(`${a.state === 'OK' ? 'i.O.' : a.state === 'NOK' ? 'n.i.O.' : 'entf.'} ${item.text}${note}`);
    else if (item.kind !== 'check' && (a.value ?? '').trim())
      lines.push(`${item.text}: ${a.value!.trim()}${item.unit ? ` ${item.unit}` : ''}${note}`);
  }
  return lines;
}
