'use client';

import type { ReactNode } from 'react';
import { Notices } from '@/components/Notices';

export default function MonteurLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <Notices />
      {children}
    </div>
  );
}
