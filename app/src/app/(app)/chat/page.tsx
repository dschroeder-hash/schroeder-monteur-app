'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';

/** Target of chat notifications: opens the chat in the right view for the signed-in role. */
function ChatRedirect() {
  const orderId = useSearchParams().get('orderId') ?? '';
  const { me } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!me) return;
    router.replace(`/monteur/chat?orderId=${orderId}`);
  }, [me, orderId, router]);
  return <p className="text-text-muted">Wird geöffnet …</p>;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChatRedirect />
    </Suspense>
  );
}
