'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';

interface Container {
  id: string;
  name: string;
  kind: string;
  capacity: number | null;
  minStock: number | null;
  hasMeter: boolean;
  quickQuantities: number[];
  active: boolean;
}
const num = 'min-h-touch w-24 rounded-card border border-border bg-surface px-2';

/** Containers/tanks (Gebinde) for the consumables shop – capacity, minimum stock, quick quantities (PROMPT 5.5). */
export function ContainersEditor() {
  const { data, reload } = useApi<Container[]>('/v1/admin/containers');
  const [msg, setMsg] = useState<string | null>(null);
  const patch = async (c: Container, body: Partial<Container>, ok: string) => {
    try {
      await apiFetch(`/v1/admin/containers/${c.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg(ok);
      await reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen');
    }
  };
  return (
    <section aria-labelledby="gebinde" className="flex flex-col gap-3">
      <h2 id="gebinde" className="font-headline text-2xl">
        Gebinde und Tanks
      </h2>
      <p className="text-sm text-text-muted">
        Neue Gebinde legt die Administration über die Schnittstelle an (Lagerort und Artikel aus BC); hier
        werden Bezeichnung, Mindestbestand, Schnellwahl-Mengen und Aktiv-Status gepflegt.
      </p>
      {msg && (
        <p role="status" className="rounded-card bg-surface-muted p-3 font-semibold">
          {msg}
        </p>
      )}
      {(data ?? []).map((c) => (
        <ContainerRow key={c.id} c={c} onSave={patch} />
      ))}
      {data && data.length === 0 && <p className="text-text-muted">Keine Gebinde angelegt.</p>}
    </section>
  );
}

function ContainerRow({
  c,
  onSave,
}: {
  c: Container;
  onSave: (c: Container, b: Partial<Container>, ok: string) => Promise<void>;
}) {
  const [minStock, setMinStock] = useState(c.minStock === null ? '' : String(c.minStock));
  const [quick, setQuick] = useState(c.quickQuantities.join(', '));
  const quantities = quick
    .split(/[,;\s]+/)
    .map((x) => Number(x.replace(',', '.')))
    .filter((x) => x > 0)
    .slice(0, 6);
  return (
    <form
      className={`flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-3 ${c.active ? '' : 'opacity-60'}`}
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(
          c,
          { minStock: minStock === '' ? null : Number(minStock), quickQuantities: quantities },
          `${c.name} gespeichert.`,
        );
      }}
    >
      <div className="min-w-48 flex-1">
        <p className="font-semibold">{c.name}</p>
        <p className="text-sm text-text-muted">
          {c.kind}
          {c.capacity ? ` · ${c.capacity.toLocaleString('de-DE')} L` : ''}
          {c.hasMeter ? ' · mit Zähler' : ''}
          {c.active ? '' : ' · inaktiv'}
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Mindestbestand
        <input
          className={num}
          type="number"
          min={0}
          value={minStock}
          onChange={(e) => setMinStock(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Schnellwahl (L)
        <input className={`${num} w-40`} value={quick} onChange={(e) => setQuick(e.target.value)} />
      </label>
      <Button type="submit" variant="secondary">
        Speichern
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() =>
          void onSave(c, { active: !c.active }, c.active ? `${c.name} deaktiviert.` : `${c.name} aktiviert.`)
        }
      >
        {c.active ? 'Deaktivieren' : 'Aktivieren'}
      </Button>
    </form>
  );
}
