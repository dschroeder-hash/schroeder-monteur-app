'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { localDb, type LocalPhoto } from '@/lib/offline/db';
import { addPhoto } from '@/lib/offline/photos';
import { useSync } from '@/lib/offline/SyncProvider';
import { toast } from './Toast';
import { Button } from './ui/Button';

export const PHOTO_CATEGORIES: Record<LocalPhoto['category'], string> = {
  VORHER: 'Schaden vorher',
  NACHHER: 'Nachher',
  TYPENSCHILD: 'Typenschild',
  BSZ: 'Betriebsstundenzähler',
  TEIL: 'Teil',
  SONSTIGES: 'Sonstiges',
};

function Thumb({ id }: { id: string }) {
  const blob = useLiveQuery(() => localDb.photoBlobs.get(id), [id]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (!url)
    return (
      <div className="flex h-24 items-center justify-center rounded-card bg-surface-muted text-xs text-text-muted">
        hochgeladen
      </div>
    );
  return <img src={url} alt="" className="h-24 w-full rounded-card object-cover" />;
}

/** Photos per order with category; camera or gallery; offline queue with resumable upload (PROMPT 5.7). */
export function OrderPhotos({ orderId }: { orderId: string }) {
  const { run, syncNow } = useSync();
  const photos =
    useLiveQuery(() => localDb.photos.where('orderId').equals(orderId).toArray(), [orderId]) ?? [];
  const queued =
    useLiveQuery(() => localDb.photoBlobs.where('orderId').equals(orderId).toArray(), [orderId]) ?? [];
  const [category, setCategory] = useState<LocalPhoto['category']>('VORHER');
  const input = useRef<HTMLInputElement>(null);
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) await addPhoto(run, orderId, f, category);
    toast(
      `${files.length} Foto(s) gespeichert${navigator.onLine ? '' : ' – Upload folgt, sobald Netz da ist'}`,
    );
    void syncNow();
  };
  return (
    <section aria-labelledby="fotos" className="flex flex-col gap-2">
      <h2 id="fotos" className="font-semibold">
        Fotos ({photos.length})
      </h2>
      <div className="flex gap-2">
        <select
          aria-label="Kategorie"
          className="min-h-touch flex-1 rounded-card border border-border bg-surface px-3"
          value={category}
          onChange={(e) => setCategory(e.target.value as LocalPhoto['category'])}
        >
          {Object.entries(PHOTO_CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          📷 Foto
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          data-testid="photo-input"
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>
      <ul className="grid grid-cols-3 gap-2">
        {photos.map((p) => {
          const q = queued.find((x) => x.id === p.id);
          return (
            <li key={p.id} className="flex flex-col gap-1">
              <Thumb id={p.id} />
              <span className="text-xs">{PHOTO_CATEGORIES[p.category]}</span>
              <span className={`text-xs ${q?.state === 'error' ? 'text-danger' : 'text-text-muted'}`}>
                {p.uploadState === 'UPLOADED'
                  ? p.mfilesObjectId
                    ? '✓ in M-Files'
                    : '✓ hochgeladen'
                  : q?.state === 'error'
                    ? 'Upload wird wiederholt'
                    : 'wartet auf Upload'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
