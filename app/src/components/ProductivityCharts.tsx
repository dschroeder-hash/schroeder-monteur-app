'use client';

import {
  PRODUCTIVITY_CATEGORIES,
  PRODUCTIVITY_CATEGORY_LABELS,
  type ProductivityCategory,
} from '@schroeder/shared';
import { useState } from 'react';

/** Fixed colour per category (never by rank) – PRODUCTIVITY_CATEGORIES order = series slots 1–6. */
export const CATEGORY_COLOR: Record<ProductivityCategory, string> = Object.fromEntries(
  PRODUCTIVITY_CATEGORIES.map((c, i) => [c, `var(--series-${i + 1})`]),
) as Record<ProductivityCategory, string>;

/** Rating against the target corridor – status colour always with icon and text. */
export const RATING: Record<'BELOW' | 'IN' | 'ABOVE', { icon: string; text: string; cls: string }> = {
  IN: { icon: '✓', text: 'im Zielkorridor', cls: 'bg-success-bg text-success' },
  ABOVE: { icon: '↑', text: 'über dem Ziel', cls: 'bg-success-bg text-success' },
  BELOW: { icon: '↓', text: 'unter dem Ziel', cls: 'bg-warning-bg text-warning' },
};

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined
    ? '–'
    : `${(v * 100).toLocaleString('de-DE', { maximumFractionDigits: digits })} %`;
export const hours = (min: number) => `${(min / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h`;
export const monthLabel = (m: string, long = false) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString(
    'de-DE',
    long ? { month: 'long', year: 'numeric' } : { month: 'short' },
  );

export function CategoryLegend({ values }: { values?: Partial<Record<ProductivityCategory, number>> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legende">
      {PRODUCTIVITY_CATEGORIES.map((c) => (
        <li key={c} className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: CATEGORY_COLOR[c] }}
          />
          <span>
            {PRODUCTIVITY_CATEGORY_LABELS[c]}
            {values && <span className="text-text-muted"> · {hours(values[c] ?? 0)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal stacked bar of hours per category (2 px surface gaps, rounded ends, hover/focus tooltip). */
export function StackedHours({
  values,
  height = 28,
  label,
}: {
  values: Record<ProductivityCategory, number>;
  height?: number;
  label: string;
}) {
  const [hover, setHover] = useState<ProductivityCategory | null>(null);
  const total = PRODUCTIVITY_CATEGORIES.reduce((s, c) => s + values[c], 0);
  if (!total) return <p className="text-sm text-text-muted">Keine verrechneten Stunden.</p>;
  const parts = PRODUCTIVITY_CATEGORIES.filter((c) => values[c] > 0);
  return (
    <div className="relative">
      <div
        role="img"
        aria-label={`${label}: ${parts.map((c) => `${PRODUCTIVITY_CATEGORY_LABELS[c]} ${hours(values[c])}`).join(', ')}`}
        className="flex w-full gap-[2px]"
        style={{ height }}
      >
        {parts.map((c, i) => (
          <div
            key={c}
            tabIndex={0}
            onMouseEnter={() => setHover(c)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(c)}
            onBlur={() => setHover(null)}
            className={`h-full outline-offset-1 ${i === 0 ? 'rounded-l' : ''} ${i === parts.length - 1 ? 'rounded-r' : ''}`}
            style={{ width: `${(values[c] / total) * 100}%`, background: CATEGORY_COLOR[c], minWidth: 4 }}
          />
        ))}
      </div>
      {hover && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-10 mt-1 rounded-card border border-border bg-surface px-3 py-1 text-sm shadow"
        >
          {PRODUCTIVITY_CATEGORY_LABELS[hover]}: <strong>{hours(values[hover])}</strong> (
          {pct(values[hover] / total)})
        </div>
      )}
    </div>
  );
}

/** 12-month trend: one bar per month, target corridor as band, values in a tooltip and a table below. */
export function TrendChart({
  trend,
  target,
}: {
  trend: Array<{ month: string; productivity: number | null }>;
  target: { min: number; max: number };
}) {
  const [hover, setHover] = useState<number | null>(null);
  // viewBox close to a phone width so the labels stay legible (≈ 12 px) on the smartphone.
  const W = 360;
  const H = 160;
  const pad = { l: 46, r: 4, t: 8, b: 22 };
  const max = Math.max(1, target.max + 0.1, ...trend.map((t) => t.productivity ?? 0));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const bw = (W - pad.l - pad.r) / trend.length;
  const ticks = [0, 0.5, 1].filter((v) => v <= max);
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-3xl"
        role="img"
        aria-label="Produktivität der letzten 12 Monate"
      >
        <rect
          x={pad.l}
          width={W - pad.l - pad.r}
          y={y(target.max)}
          height={y(target.min) - y(target.max)}
          fill="var(--chart-target)"
        />
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--color-text-muted)">
              {v * 100} %
            </text>
          </g>
        ))}
        {trend.map((t, i) => {
          const x = pad.l + i * bw + bw * 0.2;
          const v = t.productivity ?? 0;
          return (
            <g key={t.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {t.productivity !== null && (
                <path
                  d={`M${x},${y(0)} V${y(v) + 4} q0,-4 4,-4 h${bw * 0.6 - 8} q4,0 4,4 V${y(0)} Z`}
                  fill="var(--series-1)"
                  opacity={hover === null || hover === i ? 1 : 0.5}
                />
              )}
              <text
                x={x + bw * 0.3}
                y={H - 8}
                textAnchor="middle"
                fontSize={12}
                fill="var(--color-text-muted)"
              >
                {monthLabel(t.month)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          role="tooltip"
          className="absolute right-0 top-0 rounded-card border border-border bg-surface px-3 py-1 text-sm shadow"
        >
          {monthLabel(trend[hover]!.month, true)}: <strong>{pct(trend[hover]!.productivity, 1)}</strong>
        </div>
      )}
      <p className="text-sm text-text-muted">
        Grau hinterlegt: Zielkorridor {pct(target.min)}–{pct(target.max)}
      </p>
    </div>
  );
}
