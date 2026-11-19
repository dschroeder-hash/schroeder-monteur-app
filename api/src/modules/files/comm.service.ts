import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lte, ne } from 'drizzle-orm';
import type { CommandPayload } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import type { Tx } from '../../db/client.js';
import { assignment, chatMessage, chatRead, photo, serviceOrder, userLocation } from '../../db/schema.js';
import { notify } from '../notifications.js';
import { CommandRejected } from '../sync/command-rejected.js';
import { REALTIME, type Realtime } from './realtime.js';

type OrderAccess = (orderId: string) => Promise<'assigned' | 'former' | 'none'>;

/** Photos metadata and the order chat (PROMPT 5.7/5.8). */
@Injectable()
export class CommService {
  private readonly log = new Logger('Comm');

  constructor(@Inject(REALTIME) private readonly realtime: Realtime) {}

  async attachPhoto(
    tx: Tx,
    scope: AccessScope,
    id: string,
    p: CommandPayload<'AttachPhoto'>,
    access: OrderAccess,
  ) {
    if ((await access(p.orderId)) === 'none')
      throw new CommandRejected('Auftrag nicht gefunden oder nicht zugewiesen');
    const [order] = await tx
      .select({ locationId: serviceOrder.locationId })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, p.orderId));
    await tx.insert(photo).values({
      id,
      orderId: p.orderId,
      uploadedBy: scope.userId,
      category: p.category,
      blobPath: `${order!.locationId}/${p.orderId}/${id}.jpg`,
      capturedAt: new Date(p.capturedAt),
      width: p.width,
      height: p.height,
      sizeBytes: p.sizeBytes,
    });
  }

  /** Recipients of a chat message: author is Monteur → Meister of the location; otherwise the assigned Monteure. */
  private async recipients(tx: Tx, orderId: string, authorId: string): Promise<string[]> {
    const [order] = await tx
      .select({ locationId: serviceOrder.locationId })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, orderId));
    const assigned = await tx
      .selectDistinct({ userId: assignment.userId })
      .from(assignment)
      .where(and(eq(assignment.orderId, orderId), isNull(assignment.cancelledAt)));
    const meister = await tx
      .selectDistinct({ userId: userLocation.userId })
      .from(userLocation)
      .where(and(eq(userLocation.locationId, order!.locationId), eq(userLocation.role, 'MEISTER')));
    const authorIsAssigned = assigned.some((a) => a.userId === authorId);
    const set = new Set([...(authorIsAssigned ? meister : []), ...assigned].map((x) => x.userId));
    set.delete(authorId);
    return [...set];
  }

  async sendMessage(
    tx: Tx,
    scope: AccessScope,
    id: string,
    clientSeq: number | null,
    clientCreatedAt: Date,
    p: { orderId: string; body: string; photoId?: string | null },
    access: OrderAccess | null,
  ) {
    if (access && (await access(p.orderId)) === 'none')
      throw new CommandRejected('Auftrag nicht gefunden oder nicht zugewiesen');
    const [order] = await tx
      .select({ bcNo: serviceOrder.bcNo })
      .from(serviceOrder)
      .where(eq(serviceOrder.id, p.orderId));
    if (!order) throw new CommandRejected('Auftrag nicht gefunden');
    if (p.photoId) {
      const [ph] = await tx.select({ orderId: photo.orderId }).from(photo).where(eq(photo.id, p.photoId));
      if (!ph || ph.orderId !== p.orderId) throw new CommandRejected('Foto gehört nicht zu diesem Auftrag');
    }
    const [msg] = await tx
      .insert(chatMessage)
      .values({
        id,
        orderId: p.orderId,
        authorId: scope.userId,
        clientSeq,
        clientCreatedAt,
        body: p.body.trim(),
        photoId: p.photoId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!msg) return null; // idempotent replay
    const to = await this.recipients(tx, p.orderId, scope.userId);
    const preview = p.body.trim() ? p.body.trim().slice(0, 80) : '📷 Foto';
    for (const u of to)
      await notify(tx, u, 'CHAT', `Nachricht zu ${order.bcNo}`, preview, `/chat?orderId=${p.orderId}`);
    this.realtime
      .publish([`order:${p.orderId}`, ...to.map((u) => `user:${u}`)], { type: 'chat', orderId: p.orderId })
      .catch((e) => this.log.warn(`realtime: ${e}`));
    return msg;
  }

  async markRead(tx: Tx, scope: AccessScope, orderId: string, upToServerSeq: number) {
    const unread = await tx
      .select({ id: chatMessage.id })
      .from(chatMessage)
      .where(
        and(
          eq(chatMessage.orderId, orderId),
          lte(chatMessage.serverSeq, upToServerSeq),
          ne(chatMessage.authorId, scope.userId),
        ),
      );
    if (unread.length)
      await tx
        .insert(chatRead)
        .values(unread.map((m) => ({ messageId: m.id, userId: scope.userId })))
        .onConflictDoNothing();
  }

  /** Read receipts for the given messages (who has read them). */
  async readsFor(tx: Tx, messageIds: string[]) {
    if (!messageIds.length) return [];
    return tx.select().from(chatRead).where(inArray(chatRead.messageId, messageIds));
  }
}
