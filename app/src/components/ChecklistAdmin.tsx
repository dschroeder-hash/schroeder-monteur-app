'use client';

import type { ChecklistItem } from '@schroeder/shared';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { Button } from './ui/Button';

interface Template {
  id: string;
  title: string;
  locationId: string | null;
  orderTypeCode: string | null;
  brand: string | null;
  active: boolean;
  items: ChecklistItem[];
}

const EXAMPLE = `{
  "title": "Wartung Traktor",
  "orderTypeCode": "WARTUNG",
  "brand": null,
  "items": [
    { "id": "motoroel", "section": "Motor", "text": "Motoröl und Filter gewechselt" },
    { "id": "kuehler", "section": "Motor", "text": "Kühlmittelstand / Frostschutz", "kind": "value", "unit": "°C" },
    { "id": "bremsen", "section": "Fahrwerk", "text": "Bremsen geprüft" },
    { "id": "bemerkung", "text": "Hinweise an den Kunden", "kind": "text", "required": false }
  ]
}`;

/**
 * Service checklist templates (E-67). The layout comes from Business Central (template provided by the service
 * office); it is entered here as JSON. Changing a template keeps filled-in checklists (answers are per item id).
 */
export function ChecklistAdmin({ locations }: { locations: Array<{ id: string; name: string }> }) {
  const list = useApi<Template[]>('/v1/admin/checklist-templates');
  const [json, setJson] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setMsg(null);
    let body: unknown;
    try {
      body = JSON.parse(json);
    } catch {
      return setMsg('Kein gültiges JSON');
    }
    try {
      await apiFetch(editId ? `/v1/admin/checklist-templates/${editId}` : '/v1/admin/checklist-templates', {
        method: editId ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      setJson('');
      setEditId(null);
      setMsg('Gespeichert – die Geräte erhalten die Vorlage beim nächsten Abgleich.');
      await list.reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen');
    }
  };
  const edit = (t: Template) => {
    const { id: _id, ...rest } = t;
    setEditId(t.id);
    setJson(JSON.stringify(rest, null, 2));
  };
  const locName = (id: string | null) =>
    id ? (locations.find((l) => l.id === id)?.name ?? id) : 'alle Standorte';

  return (
    <section
      aria-labelledby="checklists"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <h2 id="checklists" className="text-xl font-bold">
        Servicechecklisten
      </h2>
      <p className="text-sm text-text-muted">
        Die genaueste passende Vorlage gilt: Standort + Auftragsart + Marke vor Auftragsart allein vor
        allgemein. Ohne passende Vorlage braucht der Auftrag keine Checkliste.
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {(list.data ?? []).map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-semibold">{t.title}</span>
              <span className="text-sm text-text-muted">
                {' '}
                · {locName(t.locationId)} · {t.orderTypeCode ?? 'alle Auftragsarten'} ·{' '}
                {t.brand ?? 'alle Marken'} · {t.items.length} Punkte{t.active ? '' : ' · inaktiv'}
              </span>
            </span>
            <Button variant="secondary" onClick={() => edit(t)}>
              Bearbeiten
            </Button>
          </li>
        ))}
        {list.data?.length === 0 && <li className="py-2 text-text-muted">Noch keine Vorlage angelegt.</li>}
      </ul>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{editId ? 'Vorlage bearbeiten (JSON)' : 'Neue Vorlage (JSON)'}</span>
        <textarea
          className="min-h-64 rounded-card border border-border bg-surface p-3 font-mono text-sm"
          value={json}
          placeholder={EXAMPLE}
          onChange={(e) => setJson(e.target.value)}
        />
      </label>
      <p className="text-sm text-text-muted">
        Punkte: <code>kind</code> = <code>check</code> (i.O./n.i.O./entfällt), <code>value</code> (Messwert
        mit <code>unit</code>) oder <code>text</code>; <code>required: false</code> für optionale Punkte;{' '}
        <code>locationId</code> für einen Standort; <code>&quot;active&quot;: false</code> blendet die Vorlage
        aus.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={!json.trim()}>
          {editId ? 'Änderungen speichern' : 'Vorlage anlegen'}
        </Button>
        {!editId && (
          <Button variant="secondary" onClick={() => setJson(EXAMPLE)}>
            Beispiel einfügen
          </Button>
        )}
        {editId && (
          <Button
            variant="ghost"
            onClick={() => {
              setEditId(null);
              setJson('');
            }}
          >
            Abbrechen
          </Button>
        )}
      </div>
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}
