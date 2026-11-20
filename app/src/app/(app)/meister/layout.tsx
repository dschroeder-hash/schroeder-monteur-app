import type { ReactNode } from 'react';

/** Meister area – navigation lives in the side navigation (AppShell). */
export default function MeisterLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}
