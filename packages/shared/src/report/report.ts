/** Work report, quick documentation and BC comment formatting (PROMPT 5.6). */

export const PLACEHOLDERS = [
  'Betriebsstunden',
  'Maschine',
  'Seriennummer',
  'Kunde',
  'Auftrag',
  'Datum',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type TemplateContext = Partial<Record<Placeholder, string | number | null>>;

/** Fills {Placeholders}; missing values become "…" so the Monteur sees what to complete. Unknown ones stay as typed. */
export function fillTemplate(body: string, ctx: TemplateContext): string {
  return body.replace(/\{([A-Za-zÄÖÜäöüß]+)\}/g, (m, key: string) => {
    if (!(PLACEHOLDERS as readonly string[]).includes(key)) return m;
    const v = ctx[key as Placeholder];
    if (v === null || v === undefined || v === '') return '…';
    return typeof v === 'number' ? v.toLocaleString('de-DE') : String(v);
  });
}

export interface RequiredFieldDef {
  key: string;
  label: string;
  type: 'number' | 'text';
  unit?: string;
}

export const REQUIRED_FIELD_DEFS: Record<string, RequiredFieldDef> = {
  operatingHours: { key: 'operatingHours', label: 'Betriebsstunden', type: 'number', unit: 'h' },
  mileage: { key: 'mileage', label: 'Kilometerstand', type: 'number', unit: 'km' },
  testDrive: { key: 'testDrive', label: 'Probefahrt (Ergebnis)', type: 'text' },
};

/** Default required fields per BC order type (configurable via setting `reportRequiredFields`). */
export const DEFAULT_REQUIRED_FIELDS: Record<string, string[]> = {
  WARTUNG: ['operatingHours'],
  INTWART: ['operatingHours'],
  UEBERGABE: ['operatingHours'],
};

export interface ReportState {
  body: string;
  requiredFields: Record<string, string | number | null>;
}

export function reportCompleteness(r: ReportState | null | undefined, required: readonly string[]) {
  const missing: string[] = [];
  if (!r || !r.body.trim()) missing.push('Arbeitsbericht');
  for (const f of required) {
    const v = r?.requiredFields[f];
    if (v === null || v === undefined || v === '') missing.push(REQUIRED_FIELD_DEFS[f]?.label ?? f);
  }
  return { complete: missing.length === 0, missing };
}

/**
 * Wraps text into lines of at most `width` characters (BC Service Comment Line, Comment = Text[80]).
 * Keeps paragraphs, breaks at spaces, hard-splits over-long words.
 */
export function wrapForBc(text: string, width = 80): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    let line = '';
    for (let w of words) {
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}
