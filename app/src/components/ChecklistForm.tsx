'use client';

import type { ChecklistAnswer, ChecklistItem } from '@schroeder/shared';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const EMPTY: ChecklistAnswer = { checked: false, value: null, unit: null };

/**
 * Service checklist like BC's yellow card (E-67): headings, lines with the "Eingabe" checkbox, answers as text,
 * number or choice, units fixed or to choose. Large touch targets; saved on every change (debounced) through the
 * offline outbox.
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
  // Only a change of the answers saves – never a re-render (the save itself updates the page).
  const save = useRef(onSave);
  save.current = onSave;
  const pending = useRef<Record<string, ChecklistAnswer> | null>(null);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearTimeout(timer.current);
    pending.current = results;
    timer.current = setTimeout(() => {
      pending.current = null;
      save.current(results);
    }, 600);
  }, [results]);
  // Leaving the page right after the last tap must not lose it: save what is still waiting.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current) save.current(pending.current);
    },
    [],
  );
  const set = (id: string, patch: Partial<ChecklistAnswer>) =>
    setResults((r) => ({ ...r, [id]: { ...EMPTY, ...r[id], ...patch } }));

  const field = 'min-h-touch rounded-card border border-border bg-surface px-3';
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
      {items.map((item) => {
        if (item.kind === 'heading')
          return (
            <h3 key={item.id} className="border-b border-border bg-surface-muted px-3 py-2 font-bold">
              {item.text}
            </h3>
          );
        const a = results[item.id] ?? EMPTY;
        const answer = item.answer ?? 'none';
        const units = item.unitOptions?.length ? item.unitOptions : null;
        return (
          <div
            key={item.id}
            data-check={item.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2 last:border-b-0"
          >
            {item.checkbox ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={a.checked}
                aria-label={item.text}
                onClick={() => set(item.id, { checked: !a.checked })}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 ${a.checked ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface'}`}
              >
                {a.checked && <Check aria-hidden className="h-6 w-6" strokeWidth={3} />}
              </button>
            ) : (
              <span className="w-11 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 basis-48">
              {item.text}
              {item.required && <span className="text-danger"> *</span>}
            </span>
            {answer !== 'none' && (
              <span className="flex items-center gap-2">
                {answer === 'option' ? (
                  <select
                    className={`${field} w-48`}
                    aria-label={item.text}
                    value={a.value ?? ''}
                    onChange={(e) => set(item.id, { value: e.target.value || null })}
                  >
                    <option value="">– wählen –</option>
                    {(item.options ?? []).map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={`${field} ${answer === 'number' ? 'w-28 text-right' : 'w-56'}`}
                    aria-label={item.text}
                    inputMode={answer === 'number' ? 'decimal' : undefined}
                    value={a.value ?? ''}
                    onChange={(e) => set(item.id, { value: e.target.value || null })}
                  />
                )}
                {units ? (
                  <select
                    className={`${field} w-24`}
                    aria-label={`Einheit ${item.text}`}
                    value={a.unit ?? ''}
                    onChange={(e) => set(item.id, { unit: e.target.value || null })}
                  >
                    <option value="">Einheit</option>
                    {units.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                ) : (
                  item.unit && <span className="w-10 text-text-muted">{item.unit}</span>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
