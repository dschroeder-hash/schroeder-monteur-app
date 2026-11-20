'use client';

import {
  currentState,
  deriveSegments,
  localDate,
  summarizeDay,
  type Segment,
  type StampEvent,
  DEFAULT_STAMP_CLOCK,
  type StampClockConfig,
} from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { kvGet, localDb, type LocalOrder } from './db';

export const DEFAULT_TZ = 'Europe/Berlin';

export function useTimezone(): string {
  return (
    useLiveQuery(
      async () => (await kvGet<{ timezone: string }>(localDb, 'location'))?.timezone ?? DEFAULT_TZ,
      [],
    ) ?? DEFAULT_TZ
  );
}

/** Re-renders every `ms` (running timers in the stamp bar). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Segments derived locally from all known stamp events (confirmed + pending) – identical logic to the server. */
export function useSegments(userId: string | undefined): Segment[] {
  const tz = useTimezone();
  return (
    useLiveQuery(async () => {
      if (!userId) return [];
      const events = await localDb.stampEvents.where('userId').equals(userId).toArray();
      // Same stamp clock as the server (E-69): quarter hours unless the setting switches it off.
      const settings = (await kvGet<Array<{ key: string; value: unknown }>>(localDb, 'settings')) ?? [];
      const rounding = settings.find((x) => x.key === 'rounding')?.value as
        { stampClock?: StampClockConfig | null } | undefined;
      const clock =
        rounding && 'stampClock' in rounding ? (rounding.stampClock ?? null) : DEFAULT_STAMP_CLOCK;
      return deriveSegments(
        events.map<StampEvent>((e) => ({
          id: e.id,
          kind: e.kind,
          deviceTime: e.deviceTime,
          orderId: e.orderId,
          activity: e.activity,
          overheadCode: e.overheadCode,
          seq: e.seq,
        })),
        tz,
        clock,
      );
    }, [userId, tz]) ?? []
  );
}

export function useStampState(userId: string | undefined) {
  const segments = useSegments(userId);
  const state = currentState(segments);
  const order = useLiveQuery(
    async () => (state.job?.orderId ? localDb.orders.get(state.job.orderId) : undefined),
    [state.job?.orderId],
  );
  return { ...state, order: order as LocalOrder | undefined, segments };
}

export function useDaySummary(userId: string | undefined, date?: string) {
  const tz = useTimezone();
  const segments = useSegments(userId);
  const now = useNow();
  const day = date ?? localDate(now, tz);
  const prevEnd = segments
    .filter((s) => s.kind === 'ATTENDANCE' && s.workDate < day && s.end)
    .map((s) => s.end!)
    .sort()
    .at(-1);
  return summarizeDay(day, segments, { previousAttendanceEnd: prevEnd, now });
}

export function useMyOrders(userId: string | undefined) {
  return (
    useLiveQuery(async () => {
      if (!userId) return [];
      const [orders, assignments] = await Promise.all([
        localDb.orders.toArray(),
        localDb.assignments.toArray(),
      ]);
      return orders.map((o) => ({
        ...o,
        assignments: assignments
          .filter((a) => a.orderId === o.id && a.userId === userId && !a.cancelledAt)
          .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart)),
      }));
    }, [userId]) ?? []
  );
}

export type MyOrder = ReturnType<typeof useMyOrders>[number];
