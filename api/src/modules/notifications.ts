import type { Tx } from '../db/client.js';
import { notification } from '../db/schema.js';

/** In-app notification; Web Push delivery follows in phase 5 and reads from this table. */
export async function notify(
  tx: Tx,
  userId: string,
  kind: string,
  title: string,
  body: string,
  link?: string,
) {
  await tx.insert(notification).values({ userId, kind, title, body, link: link ?? null });
}
