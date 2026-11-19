'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth/AuthProvider';
import { OfflineNavigation } from '@/lib/offline/OfflineNavigation';
import { SyncProvider } from '@/lib/offline/SyncProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SyncProvider>
        <OfflineNavigation />
        {children}
      </SyncProvider>
    </AuthProvider>
  );
}
