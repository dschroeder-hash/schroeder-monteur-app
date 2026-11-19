'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { SyncProvider } from '@/lib/offline/SyncProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SyncProvider>{children}</SyncProvider>
    </AuthProvider>
  );
}
