'use client';

import type { ChecklistAnswer, ChecklistItem } from '@schroeder/shared';
import { useEffect, useRef, useState } from 'react';

const EMPTY: ChecklistAnswer = { state: null, value: null, note: '' };
const STATES: Array<{ v: 'OK' | 'NOK' | 'NA'; label: string; on: string }> = [
  { v: 'OK', label: 'i.O.', on: 'border-success bg-success-bg text-success' },
  { v: 'NOK', label: 'n.i.O.', on: 'border-danger bg-danger-bg text-danger' },
  { v: 'NA', label: 'entfällt', on: 'border-text-muted bg-surface-muted text-text' },
];

/**
 * Fills in a service checklist (E-67) – large buttons for gloves, grouped by section. Saves on every change
 * (debounced) through the offline outbox.
 */
export function ChecklistForm({
  items,
  initial,
  onSave,
}: {
  items: ChecklistItem[];
  initial: Record<string, ChecklistAnswer>;
  onSave: (results: Record<string, ChecklistAnswer>) => void;
}) {
  const [results, setResults] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(results), 600);
    return () => clearTimeout(timer.current);
  }, [results, onSave]);
  const set = (id: string, patch: Partial<ChecklistAnswer>) =>
    setResults((r) => ({ ...r, [id]: { ...EMPTY, ...r[id], ...patch } }));

  const sections = [...new Set(items.map((i) => i.section ?? ''))];
  const field = 'min-h-touch w-full rounded-card border border-border bg-surface px-3';
  return (
    <div className="flex flex-col gap-4">
      {sections.map((sec) => (
        <fieldset key={sec || '-'} className="flex flex-col gap-2">
          {sec && <legend className="mb-1 font-bold">{sec}</legend>}
          {items
            .filter((i) => (i.section ?? '') === sec)
            .map((item) => {
              const a = results[item.id] ?? EMPTY;
              return (
                <div
                  key={item.id}
                  data-check={item.id}
                  className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {item.text}
                      {item.required === false && (
                        <span className="font-normal text-text-muted"> (optional)</span>
                      )}
                    </span>
                    {item.kind === 'check' && (
                      <div role="radiogroup" aria-label={item.text} className="flex gap-2">
                        {STATES.map((st) => (
                          <button
                            key={st.v}
                            type="button"
                            role="radio"
                            aria-checked={a.state === st.v}
                            onClick={() => set(item.id, { state: st.v })}
                            className={`min-h-touch min-w-20 rounded-card border-2 px-3 font-bold ${a.state === st.v ? st.on : 'border-border bg-surface'}`}
                          >
                            {st.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {item.kind !== 'check' && (
                      <label className="flex items-center gap-2">
                        <span className="sr-only">{item.text}</span>
                        <input
                          className={`${field} ${item.kind === 'value' ? 'w-32 text-right' : 'sm:w-72'}`}
                          inputMode={item.kind === 'value' ? 'decimal' : undefined}
                          value={a.value ?? ''}
                          onChange={(e) => set(item.id, { value: e.target.value })}
                        />
                        {item.unit && <span className="text-text-muted">{item.unit}</span>}
                      </label>
                    )}
                  </div>
                  {(a.state === 'NOK' || a.note) && (
                    <label className="flex flex-col gap-1 text-sm">
                      <span
                        className={a.state === 'NOK' && !a.note.trim() ? 'font-semibold text-danger' : ''}
                      >
                        Bemerkung{a.state === 'NOK' ? ' (Pflicht bei n.i.O.)' : ''}
                      </span>
                      <input
                        className={field}
                        value={a.note}
                        onChange={(e) => set(item.id, { note: e.target.value })}
                        aria-label={`Bemerkung zu ${item.text}`}
                      />
                    </label>
                  )}
                </div>
              );
            })}
        </fieldset>
      ))}
    </div>
  );
}
