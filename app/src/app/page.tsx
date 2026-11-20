'use client';

import { ROLES } from '@schroeder/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';

/** Routes the user to the start page of his main role. */
export default function Home() {
  const { status, me } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signed-out') router.replace('/login');
    if (status !== 'signed-in' || !me) return;
    // The Meister plans and checks in Business Central (E-66) – the app is for Monteure, Lager and Admin.
    if (me.roles.includes(ROLES.Terminal)) router.replace('/terminal');
    else if (me.roles.includes(ROLES.Monteur)) router.replace('/monteur');
    else if (me.roles.includes(ROLES.Lager)) router.replace('/lager');
    else if (me.roles.includes(ROLES.Admin)) router.replace('/admin');
    else router.replace('/login?keineRolle=1');
  }, [status, me, router]);
  return <p className="p-8 text-center text-text-muted">Wird geladen …</p>;
}
