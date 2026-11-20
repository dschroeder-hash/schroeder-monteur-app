import { and, asc, eq, isNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, photo, serviceOrder, serviceOrderItem } from '../db/schema.js';
import type { BlobStorage } from '../modules/files/blob-storage.js';
import { MFilesError, type MFilesClient } from './mfiles-client.js';

const CATEGORY: Record<string, string> = {
  VORHER: 'Vorher',
  NACHHER: 'Nachher',
  TYPENSCHILD: 'Typenschild',
  BSZ: 'Betriebsstundenzähler',
  TEIL: 'Teil',
  SONSTIGES: 'Foto',
};

/**
 * Worker job (E-73): every uploaded photo goes to M-Files as a document on the machine object of its order –
 * where the service office finds it today (M-Files view in BC). Retried up to 10 times; errors stay visible at
 * the photo (e.g. machine not found in M-Files).
 */
export async function runMFilesPhotos(
  db: Db,
  storage: BlobStorage,
  mfiles: MFilesClient,
  warn: (m: string) => void = console.warn,
): Promise<{ sent: number; failed: number }> {
  const rows = await db
    .select({ p: photo, bcNo: serviceOrder.bcNo })
    .from(photo)
    .innerJoin(serviceOrder, eq(serviceOrder.id, photo.orderId))
    .where(
      and(
        eq(photo.uploadState, 'UPLOADED'),
        isNull(photo.deletedAt),
        isNull(photo.mfilesObjectId),
        lt(photo.mfilesAttempts, 10),
      ),
    )
    .orderBy(asc(photo.createdAt))
    .limit(20);
  const machineIds = new Map<string, number | null>();
  let sent = 0;
  let failed = 0;
  for (const { p, bcNo } of rows) {
    try {
      const [m] = await db
        .select({ no: machine.serviceItemNo })
        .from(serviceOrderItem)
        .innerJoin(machine, eq(machine.id, serviceOrderItem.machineId))
        .where(eq(serviceOrderItem.orderId, p.orderId))
        .limit(1);
      if (!m) throw new MFilesError(0, 'Auftrag ohne Maschine');
      if (!machineIds.has(m.no)) machineIds.set(m.no, await mfiles.findMachine(m.no));
      const machineId = machineIds.get(m.no);
      if (!machineId) throw new MFilesError(404, `Maschine ${m.no} in M-Files nicht gefunden`);
      const bytes = await storage.read(p.blobPath);
      if (!bytes) throw new MFilesError(0, 'Foto im Speicher nicht gefunden');
      const at = (p.capturedAt ?? p.createdAt).toISOString().slice(0, 16).replace('T', ' ');
      const objectId = await mfiles.addPhoto({
        bytes,
        title: `${bcNo} ${CATEGORY[p.category] ?? 'Foto'} ${at}`,
        machineId,
        orderNo: bcNo,
      });
      await db
        .update(photo)
        .set({ mfilesObjectId: String(objectId), mfilesAt: new Date(), mfilesError: null })
        .where(eq(photo.id, p.id));
      sent++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      warn(`[mfiles] photo ${p.id}: ${message}`);
      await db
        .update(photo)
        .set({ mfilesError: message, mfilesAttempts: p.mfilesAttempts + 1 })
        .where(eq(photo.id, p.id));
    }
  }
  return { sent, failed };
}
