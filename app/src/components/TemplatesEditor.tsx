'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';

interface Template {
  id: string;
  locationId: string | null;
  orderTypeCode: string | null;
  machineGroup: string | null;
  title: string;
  body: string;
  sortOrder: number;
  active: boolean;
}
const field = 'min-h-touch rounded-card border border-border bg-surface px-3';

/**
 * Quick documentation templates (PROMPT 5.6). Meister: own location; Admin: also global templates (location "alle").
 * `locations` = the locations the user may maintain; `allowGlobal` only for the Admin.
 */
export function TemplatesEditor({
  locations,
  allowGlobal,
}: {
  locations: Array<{ id: string; name: string }>;
  allowGlobal: boolean;
}) {
  const { data, reload } = useApi<Template[]>('/v1/templates');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState({
    title: '',
    body: '',
    orderTypeCode: '',
    locationId: allowGlobal ? '' : (locations[0]?.id ?? ''),
  });
  const save = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen' });
    }
  };
  const editable = (t: Template) =>
    allowGlobal || (t.locationId !== null && locations.some((l) => l.id === t.locationId));
  const where = (t: Template) =>
    t.locationId
      ? (locations.find((l) => l.id === t.locationId)?.name ?? 'anderer Standort')
      : 'alle Standorte';

  return (
    <section aria-labelledby="bausteine" className="flex flex-col gap-3">
      <h2 id="bausteine" className="text-xl font-semibold">
        Textbausteine für den Arbeitsbericht
      </h2>
      {msg && (
        <p
          role="status"
          className={`rounded-card p-3 font-semibold ${msg.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}
        >
          {msg.text}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {(data ?? []).map((t) => (
          <li
            key={t.id}
            className={`flex flex-col gap-1 rounded-card border border-border bg-surface p-3 ${t.active ? '' : 'opacity-60'}`}
          >
            <p className="font-semibold">
              {t.title}{' '}
              <span className="text-sm font-normal text-text-muted">
                · {where(t)}
                {t.orderTypeCode ? ` · nur ${t.orderTypeCode}` : ''}
                {t.active ? '' : ' · inaktiv'}
              </span>
            </p>
            <p className="whitespace-pre-wrap text-sm">{t.body}</p>
            {editable(t) && (
              <button
                type="button"
                className="min-h-touch self-start text-sm font-semibold underline"
                onClick={() =>
                  void save(
                    () =>
                      apiFetch(`/v1/templates/${t.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ active: !t.active }),
                      }),
                    t.active ? `„${t.title}“ deaktiviert.` : `„${t.title}“ aktiviert.`,
                  )
                }
              >
                {t.active ? 'Deaktivieren' : 'Aktivieren'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save(
            () =>
              apiFetch('/v1/templates', {
                method: 'POST',
                body: JSON.stringify({
                  title: draft.title.trim(),
                  body: draft.body.trim(),
                  orderTypeCode: draft.orderTypeCode.trim().toUpperCase() || null,
                  locationId: draft.locationId || null,
                }),
              }),
            'Textbaustein angelegt.',
          ).then(() => setDraft({ ...draft, title: '', body: '', orderTypeCode: '' }));
        }}
      >
        <h3 className="text-lg font-semibold">Neuer Textbaustein</h3>
        <label className="flex flex-col gap-1 font-semibold">
          Titel (Knopfbeschriftung)
          <input
            className={field}
            value={draft.title}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            required
          />
        </label>
        <label className="flex flex-col gap-1 font-semibold">
          Text
          <textarea
            className={`${field} min-h-24 py-2`}
            value={draft.body}
            maxLength={2000}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            required
          />
          <span className="text-sm font-normal text-text-muted">
            Platzhalter werden beim Einfügen gefüllt: {'{Maschine}'}, {'{Seriennummer}'},{' '}
            {'{Betriebsstunden}'}.
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-semibold">
            Gilt für
            <select
              className={field}
              value={draft.locationId}
              onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
            >
              {allowGlobal && <option value="">alle Standorte</option>}
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            Nur Auftragsart (optional)
            <input
              className={field}
              value={draft.orderTypeCode}
              maxLength={20}
              onChange={(e) => setDraft({ ...draft, orderTypeCode: e.target.value })}
              placeholder="z. B. WARTUNG"
            />
          </label>
        </div>
        <Button
          type="submit"
          className="self-start"
          disabled={draft.title.trim().length < 2 || draft.body.trim().length < 2}
        >
          Anlegen
        </Button>
      </form>
    </section>
  );
}
