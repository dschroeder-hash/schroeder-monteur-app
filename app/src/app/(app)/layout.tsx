'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Header } from '@/components/Header';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed-out') router.replace('/login');
  }, [status, router]);
  if (status !== 'signed-in') return <p className="p-8 text-center text-text-muted">Wird geladen …</p>;
  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 pb-32 pt-4">{children}</main>
    </>
  );
}
