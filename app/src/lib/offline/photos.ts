/**
 * Photos (PROMPT 5.7): compressed on the device (max. 2,000 px, JPEG re-encoding removes all EXIF data incl. GPS,
 * capture time is kept as metadata), queued in IndexedDB and uploaded in 1 MB blocks. An interrupted upload resumes
 * with the blocks the storage does not have yet (Azure Blob block protocol, ARCHITEKTUR 4.1).
 */
import type { CommandPayload, CommandType } from '@schroeder/shared';
import { localDb } from './db';

export const MAX_EDGE = 2000;
export const BLOCK_SIZE = 1024 * 1024;

export async function compressImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error('Bild konnte nicht verarbeitet werden'))),
      'image/jpeg',
      0.85,
    ),
  );
  return { blob, width, height };
}

type Run = <T extends CommandType>(type: T, payload: CommandPayload<T>) => Promise<string>;

export async function addPhoto(
  run: Run,
  orderId: string,
  file: File,
  category: CommandPayload<'AttachPhoto'>['category'],
): Promise<string> {
  const { blob, width, height } = await compressImage(file);
  const capturedAt = new Date(file.lastModified || Date.now()).toISOString();
  const id = await run('AttachPhoto', { orderId, category, capturedAt, width, height, sizeBytes: blob.size });
  await localDb.photoBlobs.put({ id, orderId, blob, state: 'queued' });
  return id;
}

const blockId = (n: number) => btoa(`block-${String(n).padStart(6, '0')}`);

type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Uploads queued photos whose metadata already reached the server. Safe to call repeatedly. */
export async function uploadPendingPhotos(fetcher: Fetcher): Promise<number> {
  const queue = await localDb.photoBlobs.where('state').anyOf('queued', 'uploading', 'error').toArray();
  let done = 0;
  for (const item of queue) {
    // Metadata (AttachPhoto) must be on the server first.
    if (await localDb.outbox.where('id').equals(item.id).count()) continue;
    try {
      await localDb.photoBlobs.update(item.id, { state: 'uploading' });
      const target = await fetcher<{ url: string | null; uploaded: boolean }>(
        `/v1/photos/${item.id}/upload-target`,
        { method: 'POST' },
      );
      if (!target.uploaded && target.url) {
        const base = target.url;
        const join = base.includes('?') ? '&' : '?';
        const have = new Set<string>();
        const listRes = await fetch(`${base}${join}comp=blocklist&blocklisttype=uncommitted`);
        if (listRes.ok)
          for (const m of (await listRes.text()).matchAll(/<Name>([^<]+)<\/Name>/g)) have.add(m[1]!);
        const count = Math.ceil(item.blob.size / BLOCK_SIZE);
        for (let i = 0; i < count; i++) {
          const id = blockId(i);
          if (have.has(id)) continue;
          const res = await fetch(`${base}${join}comp=block&blockid=${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'x-ms-blob-type': 'BlockBlob' },
            body: item.blob.slice(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE),
          });
          if (!res.ok) throw new Error(`Block ${i} fehlgeschlagen (${res.status})`);
        }
        const xml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${Array.from({ length: count }, (_, i) => `<Latest>${blockId(i)}</Latest>`).join('')}</BlockList>`;
        const commit = await fetch(`${base}${join}comp=blocklist`, {
          method: 'PUT',
          headers: { 'content-type': 'application/xml', 'x-ms-blob-content-type': 'image/jpeg' },
          body: xml,
        });
        if (!commit.ok) throw new Error(`Abschluss fehlgeschlagen (${commit.status})`);
        await fetcher(`/v1/photos/${item.id}/complete`, { method: 'POST' });
      }
      await localDb.photos.update(item.id, { uploadState: 'UPLOADED' });
      await localDb.photoBlobs.delete(item.id);
      done++;
    } catch (e) {
      await localDb.photoBlobs.update(item.id, {
        state: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return done;
}
