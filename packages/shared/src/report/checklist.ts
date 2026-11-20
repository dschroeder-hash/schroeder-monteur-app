/**
 * Service checklist (E-67) modelled on BC's "Servicecheckliste (gelbe Karte)": headings and lines; a line may have
 * the "Eingabe" checkbox, an answer (text, number or a choice from a list) and a unit – fixed (g, ml, ltr.) or to
 * be chosen (Liter / St.). Every line is configured individually, like in BC.
 */
export interface ChecklistItem {
  id: string;
  text: string;
  kind: 'heading' | 'line';
  /** Line has the "Eingabe" checkbox. */
  checkbox?: boolean;
  answer?: 'none' | 'text' | 'number' | 'option';
  /** Choices for answer 'option' (e.g. the engine oils). */
  options?: string[];
  /** Fixed unit shown next to the answer. */
  unit?: string | null;
  /** Units to choose from (e.g. Liter / St.) – takes precedence over `unit`. */
  unitOptions?: string[];
  /** Must be filled in before "Arbeit abgeschlossen" (checkbox ticked / answer given). */
  required?: boolean;
  /** Line or whole section only for these order types (e.g. warranty / goodwill). */
  orderTypes?: string[] | null;
}
export interface ChecklistAnswer {
  checked: boolean;
  value: string | null;
  unit: string | null;
}
export interface ChecklistTemplateDef {
  id: string;
  title: string;
  orderTypeCode: string | null;
  brand: string | null;
  locationId: string | null;
  items: ChecklistItem[];
}

const numberLike = /^-?\d+([.,]\d+)?$/;

/** Lines that apply to an order type: a heading with `orderTypes` hides its whole section for other types. */
export function checklistItemsFor(items: ChecklistItem[], orderTypeCode: string): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  let sectionVisible = true;
  for (const item of items) {
    const fits = !item.orderTypes?.length || item.orderTypes.includes(orderTypeCode);
    if (item.kind === 'heading') sectionVisible = fits;
    if (sectionVisible && fits) out.push(item);
  }
  return out;
}

/** What is still missing: required lines not ticked / not answered, numbers that are none, a missing unit. */
export function checklistMissing(items: ChecklistItem[], results: Record<string, ChecklistAnswer>): string[] {
  const missing: string[] = [];
  for (const item of items) {
    if (item.kind === 'heading') continue;
    const a = results[item.id];
    const value = (a?.value ?? '').trim();
    const answer = item.answer ?? 'none';
    if (item.required) {
      if (item.checkbox && answer === 'none' && !a?.checked) missing.push(item.text);
      else if (answer !== 'none' && !value) missing.push(item.text);
    }
    if (value && answer === 'number' && !numberLike.test(value)) missing.push(`${item.text} (Zahl)`);
    if (value && item.unitOptions?.length && !a?.unit) missing.push(`${item.text} (Einheit)`);
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

/** BC comment texts: "[x] Motoröl", "Menge Motoröl: 12 Liter", "Kältemittel: 650 g" – only filled-in lines. */
export function checklistLines(items: ChecklistItem[], results: Record<string, ChecklistAnswer>): string[] {
  const lines: string[] = [];
  let heading: string | null = null;
  for (const item of items) {
    if (item.kind === 'heading') {
      heading = item.text;
      continue;
    }
    const a = results[item.id];
    if (!a) continue;
    const value = (a.value ?? '').trim();
    if (!a.checked && !value) continue;
    if (heading) {
      lines.push(`${heading}:`);
      heading = null;
    }
    const unit = a.unit ?? item.unit ?? '';
    lines.push(`${a.checked ? '[x] ' : ''}${item.text}${value ? `: ${value}${unit ? ` ${unit}` : ''}` : ''}`);
  }
  return lines;
}
