'use client';

import { FEATURE_LABELS, FEATURES, WORKS_COUNCIL_FEATURES, type Feature } from '@schroeder/shared';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/lib/useApi';

interface Location {
  id: string;
  code: string;
  name: string;
}
interface Flag {
  locationId: string | null;
  feature: Feature;
  enabled: boolean;
  note: string | null;
}

/** Feature flags per location – modules subject to works council approval are marked (BetrVG § 87). */
export default function AdminPage() {
  const locs = useApi<Location[]>('/v1/admin/locations');
  const flags = useApi<Flag[]>('/v1/admin/features');
  const [busy, setBusy] = useState(false);

  const state = (loc: string, f: Feature) =>
    flags.data?.find((x) => x.locationId === loc && x.feature === f)?.enabled;
  const toggle = async (loc: string, f: Feature, enabled: boolean) => {
    const note =
      WORKS_COUNCIL_FEATURES.includes(f) && enabled
        ? (window.prompt('Referenz Betriebsvereinbarung / Zustimmung:') ?? '')
        : undefined;
    setBusy(true);
    try {
      await apiFetch('/v1/admin/features', {
        method: 'PUT',
        body: JSON.stringify({ locationId: loc, feature: f, enabled, note }),
      });
      await flags.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-headline text-2xl">Module je Standort</h1>
      <p className="text-text-muted">
        Mit ⚖ markierte Module benötigen die Zustimmung des Betriebsrats (§ 87 Abs. 1 Nr. 6 BetrVG).
      </p>
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3">Modul</th>
              {locs.data?.map((l) => (
                <th key={l.id} className="p-3">
                  {l.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f} className="border-b border-border last:border-0">
                <td className="p-3">
                  {FEATURE_LABELS[f]}{' '}
                  {WORKS_COUNCIL_FEATURES.includes(f) && <span title="Betriebsrat">⚖</span>}
                </td>
                {locs.data?.map((l) => {
                  const v = state(l.id, f);
                  return (
                    <td key={l.id} className="p-3">
                      <label className="inline-flex min-h-touch items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-6 w-6 accent-[var(--color-primary)]"
                          checked={v ?? true}
                          disabled={busy}
                          onChange={(e) => void toggle(l.id, f, e.target.checked)}
                        />
                        <span className="text-sm text-text-muted">
                          {v === undefined ? 'Standard' : v ? 'an' : 'aus'}
                        </span>
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
