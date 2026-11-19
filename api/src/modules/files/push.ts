/**
 * Web Push delivery (VAPID) – runs in the worker. Sends notifications that have not been pushed yet to all
 * subscriptions of the recipient. Payload contains only title, short text and link (no personal details beyond
 * what the user sees in the app anyway, ARCHITEKTUR 6.1).
 */
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { location, notification, pushSubscription, timeEntry } from '../../db/schema.js';

export interface PushSender {
  send(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<{ gone: boolean }>;
}

export async function webPushSender(
  publicKey: string,
  privateKey: string,
  subject: string,
): Promise<PushSender> {
  const wp = await import('web-push');
  wp.setVapidDetails(subject, publicKey, privateKey);
  return {
    async send(sub, payload) {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 3600 },
        );
        return { gone: false };
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return { gone: true };
        throw e;
      }
    },
  };
}

export async function deliverPush(db: Db, sender: PushSender): Promise<{ sent: number; gone: number }> {
  const due = await db
    .select()
    .from(notification)
    .where(and(isNull(notification.pushedAt), gte(notification.createdAt, sql`now() - interval '1 hour'`)))
    .limit(200);
  if (!due.length) return { sent: 0, gone: 0 };
  const subs = await db
    .select()
    .from(pushSubscription)
    .where(inArray(pushSubscription.userId, [...new Set(due.map((n) => n.userId))]));
  let sent = 0;
  let gone = 0;
  for (const n of due) {
    const payload = JSON.stringify({ title: n.title, body: n.body, link: n.link, tag: n.kind });
    for (const s of subs.filter((x) => x.userId === n.userId)) {
      try {
        const r = await sender.send(s, payload);
        if (r.gone) {
          await db.delete(pushSubscription).where(eq(pushSubscription.id, s.id));
          gone++;
        } else sent++;
      } catch {
        // transient: keep for the next run (pushed_at stays null)
        continue;
      }
    }
    await db.update(notification).set({ pushedAt: new Date() }).where(eq(notification.id, n.id));
  }
  return { sent, gone };
}

/**
 * Reminder "Ausstempeln vergessen?" at the configured local time (setting forgotClockOutReminder, default 19:00):
 * once per user and day for attendance that is still open.
 */
export async function remindForgottenClockOut(db: Db): Promise<number> {
  const r = await db.execute(sql`
    insert into notification (user_id, kind, title, body, link)
    select distinct te.user_id, 'FORGOT_CLOCK_OUT', 'Ausstempeln vergessen?',
           'Sie sind noch eingestempelt. Bitte „Gehen“ stempeln.', '/monteur/zeiten'
    from ${timeEntry} te
    join ${location} l on l.id = te.location_id
    left join setting s on s.key = 'forgotClockOutReminder' and (s.location_id = l.id or s.location_id is null)
    where te.kind = 'ATTENDANCE' and te.end_at is null
      and te.work_date = (now() at time zone l.timezone)::date
      and to_char(now() at time zone l.timezone, 'HH24:MI') >= coalesce(s.value->>'time', '19:00')
      and not exists (
        select 1 from ${notification} n
        where n.user_id = te.user_id and n.kind = 'FORGOT_CLOCK_OUT'
          and (n.created_at at time zone l.timezone)::date = (now() at time zone l.timezone)::date
      )`);
  return r.rowCount ?? 0;
}
