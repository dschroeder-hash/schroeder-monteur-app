import { describe, expect, it } from 'vitest';
import { enqueue, MonteurDb, pendingCount } from './db';

describe('outbox', () => {
  it('keeps device order and is bound to the signed-in user', async () => {
    const db = new MonteurDb(`t-${Math.random()}`);
    await enqueue(db, { id: 'a', type: 'StampClockIn', payload: {}, ownerOid: 'u1' });
    await enqueue(db, { id: 'b', type: 'StampJobStart', payload: {}, ownerOid: 'u1' });
    await enqueue(db, { id: 'c', type: 'StampJobStart', payload: {}, ownerOid: 'u2' });
    const rows = await db.outbox.orderBy('seq').toArray();
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(await pendingCount(db, 'u1')).toBe(2);
    expect(await pendingCount(db, 'u2')).toBe(1);
  });
});
