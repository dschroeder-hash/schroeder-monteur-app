import { describe, expect, it } from 'vitest';
import { MonteurDb } from './db';
import { pullChanges, pushOutbox, recordCommand, type Fetcher } from './sync';

const ME = 'user-1';
const ORDER = '00000000-0000-4000-8000-0000000000a1';
const newDb = async () => {
  const db = new MonteurDb(`t-${Math.random()}`);
  await db.orders.put({
    id: ORDER,
    bcNo: 'SA-1',
    description: '',
    orderTypeCode: 'KUNDE',
    appStatus: 'EINGEPLANT',
    bcStatus: 'Pending',
    priority: 'Medium',
    responseDate: null,
    customerNo: 'D1',
    customerName: 'Hof',
    address: null,
    contactName: '',
    contactPhone: '',
    contactMobile: '',
    faultDescription: '',
    locationId: 'l1',
    items: [],
  });
  return db;
};

describe('offline commands', () => {
  it('records locally, sets status optimistically and sends in device order', async () => {
    const db = await newDb();
    await recordCommand(db, ME, 'StampClockIn', {});
    await recordCommand(db, ME, 'StampJobStart', { orderId: ORDER, activity: 'WORK' });
    expect((await db.orders.get(ORDER))!.appStatus).toBe('IN_ARBEIT');
    expect(await db.stampEvents.count()).toBe(2);

    let sent: { commands: Array<{ id: string; deviceSeq: number; type: string }> } | null = null;
    const fetcher: Fetcher = async <T>(_p: string, init?: RequestInit) => {
      sent = JSON.parse(String(init!.body));
      return {
        results: sent!.commands.map((c) => ({ id: c.id, result: 'applied' })),
        clockSkewMs: 0,
        skewFlagged: false,
      } as T;
    };
    const r = await pushOutbox(db, ME, fetcher);
    expect(r.sent).toBe(2);
    expect(sent!.commands.map((c) => c.type)).toEqual(['StampClockIn', 'StampJobStart']);
    expect(sent!.commands[0]!.deviceSeq).toBeLessThan(sent!.commands[1]!.deviceSeq);
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps rejected commands visible and stops at transient errors', async () => {
    const db = await newDb();
    const a = await recordCommand(db, ME, 'StampJobStart', { orderId: ORDER, activity: 'WORK' });
    const b = await recordCommand(db, ME, 'StampJobStop', { orderId: ORDER });
    const c = await recordCommand(db, ME, 'StampClockOut', {});
    const fetcher: Fetcher = async <T>() =>
      ({
        results: [
          { id: a, result: 'rejected', reason: 'Auftrag nicht gefunden oder nicht zugewiesen' },
          { id: b, result: 'rejected', reason: 'Vorübergehender Fehler – wird erneut versucht' },
        ],
        clockSkewMs: 0,
        skewFlagged: true,
      }) as T;
    await pushOutbox(db, ME, fetcher);
    const out = await db.outbox.toArray();
    expect(out.find((e) => e.id === a)!.status).toBe('rejected');
    expect(out.find((e) => e.id === b)!.status).toBe('pending');
    expect(out.find((e) => e.id === c)!.status).toBe('pending');
    const texts = (await db.notices.toArray()).map((n) => n.text).join(' | ');
    expect(texts).toContain('nicht zugewiesen');
    expect(texts).toContain('Uhrzeit Ihres Geräts');
  });

  it('does not send commands of another user on the same device', async () => {
    const db = await newDb();
    await recordCommand(db, 'other-user', 'StampClockIn', {});
    const r = await pushOutbox(db, ME, async () => {
      throw new Error('must not be called');
    });
    expect(r.sent).toBe(0);
  });
});

describe('pull', () => {
  const base = {
    location: { id: 'l1', code: 'WILD', name: 'Wildeshausen', timezone: 'Europe/Berlin' },
    stampEvents: [],
    statusEvents: [],
    overheadTypes: [],
    settings: [],
    serverTime: new Date().toISOString(),
  };
  it('drops time entries removed by server recomputation and announces planning changes', async () => {
    const db = await newDb();
    await db.assignments.put({
      id: 'as1',
      orderId: ORDER,
      userId: ME,
      plannedStart: '2026-11-16T07:00:00Z',
      plannedEnd: '2026-11-16T09:00:00Z',
      cancelledAt: null,
    });
    await db.timeEntries.bulkPut([
      {
        id: 't1',
        userId: ME,
        workDate: '2026-11-16',
        kind: 'ORDER',
        orderId: ORDER,
        activity: 'WORK',
        startAt: '',
        endAt: null,
        actualMinutes: 1,
        billableMinutes: 0,
        state: 'OPEN',
        needsCorrection: false,
        skewFlag: false,
      },
      {
        id: 't2',
        userId: ME,
        workDate: '2026-11-16',
        kind: 'ORDER',
        orderId: ORDER,
        activity: 'WORK',
        startAt: '',
        endAt: null,
        actualMinutes: 1,
        billableMinutes: 0,
        state: 'OPEN',
        needsCorrection: false,
        skewFlag: false,
      },
    ]);
    await db.kv.put({ key: 'cursor', value: '100' });
    const fetcher: Fetcher = async <T>(path: string) => {
      expect(path).toBe('/v1/sync/pull?cursor=100');
      return {
        ...base,
        cursor: '120',
        full: false,
        orders: [],
        assignments: [
          {
            id: 'as1',
            orderId: ORDER,
            userId: ME,
            plannedStart: '2026-11-17T07:00:00Z',
            plannedEnd: '2026-11-17T09:00:00Z',
            cancelledAt: null,
          },
        ],
        timeEntries: [],
        timeEntryKeysByDay: { '2026-11-16': ['t1'] },
      } as T;
    };
    await pullChanges(db, ME, fetcher);
    expect((await db.timeEntries.toArray()).map((t) => t.id)).toEqual(['t1']);
    expect((await db.kv.get('cursor'))!.value).toBe('120');
    expect((await db.notices.toArray())[0]!.text).toContain('Planung wurde geändert: SA-1');
  });

  it('removes orders that are no longer mine', async () => {
    const db = await newDb();
    await db.assignments.put({
      id: 'as1',
      orderId: ORDER,
      userId: ME,
      plannedStart: '',
      plannedEnd: '',
      cancelledAt: null,
    });
    await db.kv.put({ key: 'cursor', value: '1' });
    await pullChanges(
      db,
      ME,
      async <T>() =>
        ({
          ...base,
          cursor: '2',
          full: false,
          orders: [],
          timeEntries: [],
          timeEntryKeysByDay: {},
          assignments: [
            {
              id: 'as1',
              orderId: ORDER,
              userId: ME,
              plannedStart: '',
              plannedEnd: '',
              cancelledAt: '2026-11-16T10:00:00Z',
            },
          ],
        }) as T,
    );
    expect(await db.orders.get(ORDER)).toBeUndefined();
  });
});

describe('status history', () => {
  it('replaces optimistic status entries with the server version after sync', async () => {
    const db = await newDb();
    await recordCommand(db, ME, 'StampJobStart', { orderId: ORDER, activity: 'WORK' });
    await db.outbox.clear(); // pushed
    await db.kv.put({ key: 'cursor', value: '1' });
    await pullChanges(
      db,
      ME,
      async <T>() =>
        ({
          location: { id: 'l1', code: 'WILD', name: 'W', timezone: 'Europe/Berlin' },
          stampEvents: [],
          overheadTypes: [],
          settings: [],
          serverTime: '',
          cursor: '2',
          full: false,
          orders: [],
          timeEntries: [],
          timeEntryKeysByDay: {},
          assignments: [
            { id: 'as1', orderId: ORDER, userId: ME, plannedStart: 'x', plannedEnd: 'x', cancelledAt: null },
          ],
          statusEvents: [
            {
              id: 'srv-1',
              orderId: ORDER,
              fromStatus: 'EINGEPLANT',
              toStatus: 'IN_ARBEIT',
              source: 'STEMPELUNG',
              at: '2026-11-16T07:00:00Z',
            },
          ],
        }) as T,
    );
    expect((await db.statusEvents.toArray()).map((e) => e.id)).toEqual(['srv-1']);
  });
});

describe('every command type can be recorded offline', () => {
  it('records all command types without transaction errors', async () => {
    const { COMMAND_TYPES } = await import('@schroeder/shared');
    const db = await newDb();
    const uuid = '00000000-0000-4000-8000-0000000000b1';
    const payloads: Record<string, Record<string, unknown>> = {
      StampJobStart: { orderId: ORDER, activity: 'WORK' },
      StampOverheadStart: { overheadCode: 'WERKSTATTPFLEGE' },
      SetOrderStatus: { orderId: ORDER, status: 'WARTET_KUNDE' },
      RequestTimeCorrection: { workDate: '2026-11-16', proposal: [{ kind: 'CLOCK_OUT', time: '16:00' }] },
      ConsumeItem: { orderId: ORDER, itemId: uuid, storageLocationId: uuid, quantity: 1 },
      RemoveConsumption: { consumptionId: uuid },
      RequestPart: { orderId: ORDER, itemId: uuid, quantity: 1, setWaitingForParts: false },
      SaveWorkReport: { orderId: ORDER, body: 'Text', requiredFields: {}, usedTemplateIds: [] },
      AttachPhoto: {
        orderId: ORDER,
        category: 'VORHER',
        capturedAt: new Date().toISOString(),
        width: 10,
        height: 10,
        sizeBytes: 100,
      },
      SendChatMessage: { orderId: ORDER, body: 'Hallo' },
      MarkChatRead: { orderId: ORDER, upToServerSeq: 1 },
      ReportSick: { fromDate: '2026-11-20' },
      UpdateSickEnd: { absenceId: uuid, toDate: '2026-11-21' },
      RequestVacation: { fromDate: '2027-03-01', toDate: '2027-03-05', halfDay: 'NONE' },
      WithdrawVacation: { absenceId: uuid },
    };
    for (const type of COMMAND_TYPES) await recordCommand(db, ME, type, (payloads[type] ?? {}) as never);
    expect(await db.outbox.count()).toBe(COMMAND_TYPES.length);
    expect((await db.workReports.get(ORDER))?.body).toBe('Text');
    expect(await db.chatMessages.count()).toBe(1);
    expect(await db.photos.count()).toBe(1);
    expect((await db.absences.toArray()).map((a) => a.type).sort()).toEqual(['KRANK', 'URLAUB']);
  });
});
