'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const ITEMS = [
  { href: '/meister', label: 'Übersicht' },
  { href: '/meister/plantafel', label: 'Plantafel' },
  { href: '/meister/freigaben', label: 'Freigaben' },
];

export default function MeisterLayout({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Meister" className="flex gap-2 overflow-x-auto">
        {ITEMS.map((i) => {
          const active = i.href === '/meister' ? path === '/meister' : path.startsWith(i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-touch items-center rounded-card border-2 px-4 font-semibold ${active ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface'}`}
            >
              {i.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
