'use client';

import {
  PRODUCTIVITY_CATEGORIES,
  PRODUCTIVITY_CATEGORY_LABELS,
  type ProductivityCategory,
} from '@schroeder/shared';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, ApiError } from '@/lib/api';
import { fmtDay } from '@/lib/format';
import { useApi } from '@/lib/useApi';

interface Rule {
  id: string;
  orderTypeCode: string;
  category: ProductivityCategory;
  productive: boolean;
  external: boolean;
  validFrom: string;
}
interface Cfg {
  mapping: Rule[];
  orderTypes: Array<{ code: string; description: string }>;
  config: { targetMin: number; targetMax: number; legacyMaintenanceRule: boolean };
}
const field = 'min-h-touch rounded-card border border-border bg-surface px-3';

/**
 * Mapping BC order type → productivity category (versioned, PROMPT 5.11 / E-23) and target corridor.
 * New versions apply from their date; closed months are never recalculated.
 */
export function ProductivityAdmin() {
  const { data, reload } = useApi<Cfg>('/v1/admin/productivity');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rule, setRule] = useState({
    orderTypeCode: '',
    category: 'KUNDENSERVICE' as ProductivityCategory,
    productive: true,
    external: true,
    validFrom: today,
  });
  const [cfg, setCfg] = useState({ targetMin: '80', targetMax: '85', legacyMaintenanceRule: false });
  useEffect(() => {
    if (data)
      setCfg({
        targetMin: String(Math.round(data.config.targetMin * 100)),
        targetMax: String(Math.round(data.config.targetMax * 100)),
        legacyMaintenanceRule: data.config.legacyMaintenanceRule,
      });
  }, [data]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      await reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen' });
    }
  };
  // Current rule per order type (newest validFrom ≤ today) and planned future versions.
  const codes = [
    ...new Set([
      ...(data?.orderTypes.map((o) => o.code) ?? []),
      ...(data?.mapping.map((m) => m.orderTypeCode) ?? []),
    ]),
  ].sort();
  const currentFor = (code: string) =>
    data?.mapping
      .filter((m) => m.orderTypeCode === code && m.validFrom <= today)
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];

  return (
    <section aria-labelledby="prod-admin" className="flex flex-col gap-4">
      <h2 id="prod-admin" className="font-headline text-2xl">
        Produktivität: Auftragsarten und Ziel
      </h2>
      {msg && (
        <p
          role="status"
          className={`rounded-card p-3 font-semibold ${msg.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}
        >
          {msg.text}
        </p>
      )}
      <div
        tabIndex={0}
        role="region"
        aria-label="Zuordnung der Auftragsarten (seitlich scrollbar)"
        className="overflow-x-auto rounded-card border border-border bg-surface"
      >
        <table className="w-full min-w-[40rem] text-left">
          <thead className="bg-surface-muted">
            <tr>
              <th className="p-2">BC-Auftragsart</th>
              <th className="p-2">Kategorie</th>
              <th className="p-2">produktiv</th>
              <th className="p-2">extern</th>
              <th className="p-2">gültig ab</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => {
              const r = currentFor(code);
              const future =
                data?.mapping.filter((m) => m.orderTypeCode === code && m.validFrom > today) ?? [];
              return (
                <tr key={code} className="border-t border-border">
                  <td className="p-2 font-semibold">
                    {code}{' '}
                    <span className="font-normal text-text-muted">
                      {data?.orderTypes.find((o) => o.code === code)?.description}
                    </span>
                  </td>
                  <td className="p-2">
                    {r ? (
                      PRODUCTIVITY_CATEGORY_LABELS[r.category]
                    ) : (
                      <span className="text-warning">nicht zugeordnet → Intern sonstige</span>
                    )}
                  </td>
                  <td className="p-2">{r ? (r.productive ? 'ja' : 'nein') : 'nein'}</td>
                  <td className="p-2">{r ? (r.external ? 'ja' : 'nein') : 'nein'}</td>
                  <td className="p-2">
                    {r ? fmtDay(r.validFrom) : '–'}
                    {future.map((f) => (
                      <p key={f.id} className="text-xs text-text-muted">
                        ab {fmtDay(f.validFrom)}: {PRODUCTIVITY_CATEGORY_LABELS[f.category]},{' '}
                        {f.productive ? 'produktiv' : 'nicht produktiv'}
                      </p>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-text-muted">
        Nacharbeit (Kennzeichen am Auftrag) zählt immer als nicht produktiv.
      </p>

      <form
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            () => apiFetch('/v1/admin/productivity/mapping', { method: 'POST', body: JSON.stringify(rule) }),
            `Zuordnung für ${rule.orderTypeCode} ab ${fmtDay(rule.validFrom)} gespeichert.`,
          );
        }}
      >
        <h3 className="text-lg font-semibold">Zuordnung ändern (neue Version)</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 font-semibold">
            BC-Auftragsart
            <input
              className={field}
              list="order-types"
              value={rule.orderTypeCode}
              onChange={(e) => setRule({ ...rule, orderTypeCode: e.target.value.toUpperCase() })}
              required
              maxLength={20}
            />
            <datalist id="order-types">
              {codes.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            Kategorie
            <select
              className={field}
              value={rule.category}
              onChange={(e) => setRule({ ...rule, category: e.target.value as ProductivityCategory })}
            >
              {PRODUCTIVITY_CATEGORIES.filter((c) => c !== 'NACHARBEIT').map((c) => (
                <option key={c} value={c}>
                  {PRODUCTIVITY_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            Gültig ab
            <input
              type="date"
              className={field}
              value={rule.validFrom}
              min={`${today.slice(0, 7)}-01`}
              onChange={(e) => setRule({ ...rule, validFrom: e.target.value })}
              required
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex min-h-touch items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={rule.productive}
              onChange={(e) => setRule({ ...rule, productive: e.target.checked })}
            />
            zählt produktiv
          </label>
          <label className="flex min-h-touch items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={rule.external}
              onChange={(e) => setRule({ ...rule, external: e.target.checked })}
            />
            extern verrechnet
          </label>
        </div>
        <p className="text-sm text-text-muted">
          Abgeschlossene Monate bleiben unverändert; die Änderung gilt ab dem gewählten Tag.
        </p>
        <Button type="submit" className="self-start" disabled={!rule.orderTypeCode}>
          Zuordnung speichern
        </Button>
      </form>

      <form
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            () =>
              apiFetch('/v1/admin/productivity/config', {
                method: 'PUT',
                body: JSON.stringify({
                  targetMin: Number(cfg.targetMin) / 100,
                  targetMax: Number(cfg.targetMax) / 100,
                  legacyMaintenanceRule: cfg.legacyMaintenanceRule,
                }),
              }),
            'Zielkorridor gespeichert.',
          );
        }}
      >
        <h3 className="text-lg font-semibold">Zielkorridor und Altdaten</h3>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 font-semibold">
            Ziel von (%)
            <input
              type="number"
              min={0}
              max={200}
              className={`${field} w-28`}
              value={cfg.targetMin}
              onChange={(e) => setCfg({ ...cfg, targetMin: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            bis (%)
            <input
              type="number"
              min={0}
              max={200}
              className={`${field} w-28`}
              value={cfg.targetMax}
              onChange={(e) => setCfg({ ...cfg, targetMax: e.target.value })}
            />
          </label>
        </div>
        <label className="flex min-h-touch items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={cfg.legacyMaintenanceRule}
            onChange={(e) => setCfg({ ...cfg, legacyMaintenanceRule: e.target.checked })}
          />
          Altdaten-Regel: Kundenaufträge mit „Wartung“ im Titel als Wartung Kunde werten
        </label>
        <Button type="submit" className="self-start">
          Speichern
        </Button>
      </form>
    </section>
  );
}
