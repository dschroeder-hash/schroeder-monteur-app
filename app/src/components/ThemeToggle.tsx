'use client';

import { useEffect, useState } from 'react';

type Theme = 'auto' | 'light' | 'dark';
const LABEL: Record<Theme, string> = {
  auto: 'Automatisch',
  light: 'Hell (Sonnenlicht)',
  dark: 'Dunkel (Werkstatt)',
};

/** Light for outdoor sunlight, dark for the workshop; preference is stored per device. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('auto');
  useEffect(() => {
    try {
      setTheme((localStorage.getItem('theme') as Theme | null) ?? 'auto');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const apply = (t: Theme) => {
    setTheme(t);
    try {
      localStorage.setItem('theme', t);
    } catch {
      /* ignore */
    }
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  };
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-text-muted">Darstellung</span>
      <select
        value={theme}
        onChange={(e) => apply(e.target.value as Theme)}
        className="min-h-touch rounded-card border border-border bg-surface px-3 text-text"
      >
        {(Object.keys(LABEL) as Theme[]).map((t) => (
          <option key={t} value={t}>
            {LABEL[t]}
          </option>
        ))}
      </select>
    </label>
  );
}
