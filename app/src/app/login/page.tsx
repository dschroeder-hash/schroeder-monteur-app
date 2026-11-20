'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthProvider';
import { config } from '@/lib/config';

interface Persona {
  key: string;
  name: string;
}

export default function LoginPage() {
  const { status, login } = useAuth();
  const router = useRouter();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signed-in') router.replace('/');
  }, [status, router]);
  useEffect(() => {
    if (config.authMode === 'dev')
      apiFetch<Persona[]>('/dev/personas')
        .then(setPersonas)
        .catch(() => setError('API nicht erreichbar'));
  }, []);

  const go = async (key?: string) => {
    setError(null);
    try {
      await login(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Anmeldung fehlgeschlagen');
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <img
        src={`${config.basePath}/brand/logo.svg`}
        alt="Schröder Landmaschinen"
        className="h-14 w-auto self-start rounded-md bg-white px-1"
      />
      <h1 className="font-headline text-3xl">Werkstatt-App</h1>
      <p className="text-text-muted">Melden Sie sich mit Ihrem Schröder-Konto an.</p>
      {config.authMode === 'entra' ? (
        <Button size="lg" onClick={() => void go()}>
          Mit Microsoft anmelden
        </Button>
      ) : (
        <section
          aria-labelledby="dev-login"
          // Space reserved for the persona list (loaded asynchronously) – no layout shift.
          className="flex min-h-[35rem] flex-col gap-2 rounded-card border-2 border-dashed border-warning p-4"
        >
          <h2 id="dev-login" className="font-semibold text-warning">
            Entwicklungs-Login (nur Test)
          </h2>
          {personas.map((p) => (
            <Button key={p.key} variant="secondary" onClick={() => void go(p.key)} data-persona={p.key}>
              {p.name}
            </Button>
          ))}
        </section>
      )}
      {error && (
        <p role="alert" className="rounded-card bg-danger-bg p-3 text-danger">
          {error}
        </p>
      )}
    </main>
  );
}
