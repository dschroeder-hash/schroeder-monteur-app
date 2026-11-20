'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthProvider';

const ITEMS = [
  { href: '/monteur', label: 'Start' },
  { href: '/monteur/kalender', label: 'Kalender' },
  { href: '/monteur/zeiten', label: 'Zeiten' },
  { href: '/monteur/abwesenheit', label: 'Abwesenheit' },
];

export function MonteurNav() {
  const path = usePathname();
  const { me } = useAuth();
  const items = ITEMS.filter(
    (i) =>
      i.href !== '/monteur/abwesenheit' || me?.features['absence.sick'] || me?.features['absence.vacation'],
  );
  return (
    <nav
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-30 h-16 border-t border-border bg-surface"
    >
      <ul className={`mx-auto grid h-full max-w-3xl ${items.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {items.map((i) => {
          const active = i.href === '/monteur' ? path === '/monteur' : path.startsWith(i.href);
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full items-center justify-center px-1 text-center font-semibold ${items.length === 4 ? 'text-sm sm:text-base' : ''} ${active ? 'border-t-4 border-t-accent text-text' : 'text-text-muted'}`}
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
