'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/monteur', label: 'Start' },
  { href: '/monteur/kalender', label: 'Kalender' },
  { href: '/monteur/zeiten', label: 'Zeiten' },
];

export function MonteurNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-30 h-16 border-t border-border bg-surface"
    >
      <ul className="mx-auto grid h-full max-w-3xl grid-cols-3">
        {ITEMS.map((i) => {
          const active = i.href === '/monteur' ? path === '/monteur' : path.startsWith(i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full items-center justify-center font-semibold ${active ? 'border-t-4 border-t-accent text-text' : 'text-text-muted'}`}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
