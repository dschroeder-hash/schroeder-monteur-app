'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth/AuthProvider';
import { kvGet, kvSet, localDb } from '@/lib/offline/db';
import { addPhoto } from '@/lib/offline/photos';
import { useSync } from '@/lib/offline/SyncProvider';

/** Order chat for the Monteur – works offline; messages are delivered in the order written (PROMPT 5.8). */
function MonteurChat() {
  const orderId = useSearchParams().get('orderId') ?? '';
  const { me } = useAuth();
  const { run, syncNow } = useSync();
  const order = useLiveQuery(() => localDb.orders.get(orderId), [orderId]);
  const messages =
    useLiveQuery(
      async () =>
        (await localDb.chatMessages.where('orderId').equals(orderId).toArray()).sort(
          (a, b) =>
            (a.serverSeq ?? Number.MAX_SAFE_INTEGER) - (b.serverSeq ?? Number.MAX_SAFE_INTEGER) ||
            (a.clientCreatedAt ?? a.createdAt).localeCompare(b.clientCreatedAt ?? b.createdAt),
        ),
      [orderId],
    ) ?? [];
  const reads = useLiveQuery(() => localDb.chatReads.toArray(), []) ?? [];
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);
  // Read receipt up to the newest server message (sent once per new message).
  const maxSeq = Math.max(
    0,
    ...messages.filter((m) => m.authorId !== me?.id && m.serverSeq).map((m) => m.serverSeq!),
  );
  useEffect(() => {
    if (!maxSeq) return;
    void (async () => {
      const key = `chatRead:${orderId}`;
      if (((await kvGet<number>(localDb, key)) ?? 0) >= maxSeq) return;
      await kvSet(localDb, key, maxSeq);
      await run('MarkChatRead', { orderId, upToServerSeq: maxSeq });
    })();
  }, [maxSeq, orderId, run]);

  const send = async () => {
    if (!text.trim()) return;
    await run('SendChatMessage', { orderId, body: text.trim() });
    setText('');
  };
  const sendPhoto = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const photoId = await addPhoto(run, orderId, f, 'SONSTIGES');
    await run('SendChatMessage', { orderId, body: '', photoId });
    void syncNow();
  };

  return (
    <div className="flex flex-col gap-3">
      <header>
        <p className="text-sm text-text-muted">{order ? `${order.bcNo} · ${order.customerName}` : ''}</p>
        <h1 className="font-headline text-2xl">Chat zum Auftrag</h1>
      </header>
      <ol className="flex flex-col gap-2" aria-label="Nachrichten">
        {messages.map((m) =>
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
              {m.photoId && <p className="text-sm">📷 Foto</p>}
              {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
              <p className="mt-1 text-right text-xs opacity-80">
                {new Date(m.clientCreatedAt ?? m.createdAt).toLocaleTimeString('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {m.authorId === me?.id &&
                  (m.pending
                    ? ' · wird gesendet'
                    : reads.some((r) => r.messageId === m.id && r.userId !== me?.id)
                      ? ' · gelesen'
                      : ' · zugestellt')}
              </p>
            </li>
          ),
        )}
        <div ref={end} />
      </ol>
      <form
        className="sticky bottom-40 flex gap-2 bg-bg py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Button
          type="button"
          variant="secondary"
          aria-label="Foto senden"
          onClick={() => fileInput.current?.click()}
        >
          📷
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => void sendPhoto(e.target.files)}
        />
        <label className="sr-only" htmlFor="chat-input">
          Nachricht
        </label>
        <input
          id="chat-input"
          className="min-h-touch min-w-0 flex-1 rounded-card border border-border bg-surface px-3"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nachricht an den Meister"
        />
        <Button type="submit">Senden</Button>
      </form>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-text-muted">Wird geladen …</p>}>
      <MonteurChat />
    </Suspense>
  );
}
