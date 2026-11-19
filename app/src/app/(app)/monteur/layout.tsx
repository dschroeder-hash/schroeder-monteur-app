'use client';

import type { ReactNode } from 'react';
import { MonteurNav } from '@/components/MonteurNav';
import { Notices } from '@/components/Notices';
import { StampBar } from '@/components/StampBar';
import { ToastHost } from '@/components/Toast';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function MonteurLayout({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  return (
    <div className={`flex flex-col gap-4 ${me?.features.stamping ? 'pb-72' : 'pb-24'}`}>
      <Notices />
      {children}
      {me?.features.stamping && <StampBar />}
      <ToastHost />
      <MonteurNav />
    </div>
  );
}
