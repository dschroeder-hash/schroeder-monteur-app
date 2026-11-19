'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth/AuthProvider';

interface Msg {
  id: string;
  authorId: string | null;
  authorName: string | null;
  serverSeq: number;
  body: string;
  photoId: string | null;
  isSystem: boolean;
  createdAt: string;
  clientCreatedAt: string | null;
  readBy: string[];
}

/** Order chat for the Meister (online; refreshes every 10 s or on realtime events). */
function MeisterChat() {
  const orderId = useSearchParams().get('orderId') ?? '';
  const { me } = useAuth();
  const [data, setData] = useState<{ order: { bcNo: string; customerName: string }; messages: Msg[] } | null>(
    null,
  );
  const [text, setText] = useState('');
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const d = await apiFetch<{ order: { bcNo: string; customerName: string }; messages: Msg[] }>(
      `/v1/orders/${orderId}/chat`,
    );
    setData(d);
    const max = Math.max(0, ...d.messages.filter((m) => m.authorId !== me?.id).map((m) => m.serverSeq));
    if (max)
      void apiFetch(`/v1/orders/${orderId}/chat/read`, {
        method: 'POST',
        body: JSON.stringify({ upToServerSeq: max }),
      });
    for (const m of d.messages.filter((x) => x.photoId && !photoUrls[x.photoId!]))
      apiFetch<{ url: string }>(`/v1/photos/${m.photoId}/url`)
        .then((r) => setPhotoUrls((p) => ({ ...p, [m.photoId!]: r.url })))
        .catch(() => undefined);
  }, [orderId, me?.id, photoUrls]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [orderId]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);
  const send = async () => {
    if (!text.trim()) return;
    await apiFetch(`/v1/orders/${orderId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ body: text.trim() }),
    });
    setText('');
    await load();
  };
  return (
    <div className="flex flex-col gap-3">
      <header>
        <p className="text-sm text-text-muted">
          {data ? `${data.order.bcNo} · ${data.order.customerName}` : ''}
        </p>
        <h1 className="font-headline text-2xl">Chat zum Auftrag</h1>
      </header>
      <ol className="flex flex-col gap-2">
        {data?.messages.map((m) =>
          m.isSystem ? (
            <li
              key={m.id}
              className="self-center rounded-full bg-surface-muted px-3 py-1 text-sm text-text-muted"
            >
              {m.body}
            </li>
          ) : (
            <li
              key={m.id}
              className={`max-w-[85%] rounded-card p-3 ${m.authorId === me?.id ? 'self-end bg-primary text-on-primary' : 'self-start border border-border bg-surface'}`}
            >
              {m.authorId !== me?.id && <p className="text-xs font-semibold">{m.authorName}</p>}
              {m.photoId &&
                (photoUrls[m.photoId] ? (
                  <img src={photoUrls[m.photoId]} alt="Foto vom Monteur" className="max-h-64 rounded-card" />
                ) : (
                  <p>📷 Foto (Upload läuft)</p>
                ))}
              {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
              <p className="mt-1 text-right text-xs opacity-80">
                {new Date(m.clientCreatedAt ?? m.createdAt).toLocaleString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {m.authorId === me?.id && (m.readBy.length ? ' · gelesen' : ' · zugestellt')}
              </p>
            </li>
          ),
        )}
        <div ref={end} />
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="m-chat">
          Nachricht
        </label>
        <input
          id="m-chat"
          className="min-h-touch min-w-0 flex-1 rounded-card border border-border bg-surface px-3"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nachricht an den Monteur"
        />
        <Button type="submit">Senden</Button>
      </form>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-text-muted">Wird geladen …</p>}>
      <MeisterChat />
    </Suspense>
  );
}
