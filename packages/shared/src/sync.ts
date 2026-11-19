/**
 * Offline sync protocol (ARCHITEKTUR 4, ENTSCHEIDUNGEN E-06).
 * The client writes commands into its outbox; POST /v1/sync/push applies them idempotently in device order.
 */
import { z } from 'zod';
import { APP_STATUSES } from './status.js';
import { ACTIVITIES } from './time/model.js';

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

/** Stamp command payloads. The command id doubles as stamp event id. */
const stamp = {
  StampClockIn: z.object({}),
  StampClockOut: z.object({}),
  StampJobStart: z.object({ orderId: uuid, activity: z.enum(ACTIVITIES) }),
  StampJobPause: z.object({ orderId: uuid.optional() }),
  StampJobStop: z.object({ orderId: uuid.optional() }),
  StampOverheadStart: z.object({ overheadCode: z.string().min(1).max(40) }),
  StampOverheadStop: z.object({}),
  StampBreakStart: z.object({}),
  StampBreakStop: z.object({}),
};

export const COMMAND_PAYLOADS = {
  ...stamp,
  SetOrderStatus: z.object({
    orderId: uuid,
    status: z.enum(APP_STATUSES),
    note: z.string().max(500).optional(),
  }),
} as const;

export type CommandType = keyof typeof COMMAND_PAYLOADS;
export const COMMAND_TYPES = Object.keys(COMMAND_PAYLOADS) as CommandType[];
export type CommandPayload<T extends CommandType> = z.infer<(typeof COMMAND_PAYLOADS)[T]>;

export const STAMP_COMMAND_KIND = {
  StampClockIn: 'CLOCK_IN',
  StampClockOut: 'CLOCK_OUT',
  StampJobStart: 'JOB_START',
  StampJobPause: 'JOB_PAUSE',
  StampJobStop: 'JOB_STOP',
  StampOverheadStart: 'OVERHEAD_START',
  StampOverheadStop: 'OVERHEAD_STOP',
  StampBreakStart: 'BREAK_START',
  StampBreakStop: 'BREAK_STOP',
} as const;

export const commandSchema = z.object({
  id: uuid,
  type: z.enum(COMMAND_TYPES as [CommandType, ...CommandType[]]),
  deviceTime: isoDateTime,
  deviceSeq: z.number().int().nonnegative(),
  payload: z.unknown(),
});
export type SyncCommand = z.infer<typeof commandSchema>;

export const pushRequestSchema = z.object({
  deviceId: z.string().min(8).max(100),
  /** Device clock at send time; used to detect clock skew (PROMPT 5.1). */
  deviceNow: isoDateTime,
  commands: z.array(commandSchema).max(500),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export type CommandResultCode = 'applied' | 'duplicate' | 'rejected';
export interface CommandResult {
  id: string;
  result: CommandResultCode;
  /** German, user-facing */
  reason?: string;
  warnings?: string[];
}
export interface PushResponse {
  results: CommandResult[];
  clockSkewMs: number;
  skewFlagged: boolean;
}

/** Clock skew above which events are flagged for the Meister (configurable later). */
export const CLOCK_SKEW_THRESHOLD_MS = 2 * 60_000;
