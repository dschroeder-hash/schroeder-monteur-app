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
  /** Monteur asks the Meister to correct a day, e.g. forgotten clock-out (PROMPT 5.1). Times are local HH:mm. */
  RequestTimeCorrection: z.object({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    proposal: z
      .array(
        z.object({
          kind: z.enum(['CLOCK_OUT', 'CLOCK_IN', 'BREAK_START', 'BREAK_STOP']),
          time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        }),
      )
      .min(1)
      .max(6),
    comment: z.string().max(500).optional(),
  }),
  /**
   * Withdrawal of a part or consumable (PROMPT 5.4/5.5). Booked on the order, or internally (diesel for
   * service van / demo machine) with a cost centre. Stock is reduced locally at once, approval by the Meister.
   */
  ConsumeItem: z
    .object({
      orderId: uuid.nullish(),
      itemId: uuid,
      storageLocationId: uuid,
      containerId: uuid.nullish(),
      quantity: z.number().positive().max(100_000),
      internalPurpose: z.enum(['SERVICEWAGEN', 'VORFUEHRMASCHINE', 'SONSTIGES']).nullish(),
      costCenter: z.string().max(20).nullish(),
      meterBefore: z.number().nonnegative().nullish(),
      meterAfter: z.number().nonnegative().nullish(),
    })
    .refine((v) => !!v.orderId || (!!v.internalPurpose && !!v.costCenter), {
      message: 'Ohne Auftrag sind Zweck und Kostenstelle Pflicht',
    }),
  /** Undo a withdrawal that has not been approved yet (wrong tap). */
  RemoveConsumption: z.object({ consumptionId: uuid }),
  /** Part missing at the location → request to the own warehouses (overnight, cutoff 17:00). */
  RequestPart: z
    .object({
      orderId: uuid,
      itemId: uuid.nullish(),
      newItemText: z.string().max(200).nullish(),
      manufacturerPartNo: z.string().max(60).nullish(),
      quantity: z.number().positive().max(10_000),
      sourceBcLocationCode: z.string().max(20).nullish(),
      /** Monteur confirms → order status "Wartet auf Teile". */
      setWaitingForParts: z.boolean().default(false),
    })
    .refine((v) => !!v.itemId || !!v.newItemText, { message: 'Artikel oder Beschreibung angeben' }),
  /** Work report (PROMPT 5.6). Whole document; the newest device time wins (ARCHITEKTUR 4.3). */
  SaveWorkReport: z.object({
    orderId: uuid,
    body: z.string().max(20_000),
    requiredFields: z.record(z.string(), z.union([z.string().max(200), z.number(), z.null()])).default({}),
    usedTemplateIds: z.array(uuid).max(100).default([]),
  }),
  /** Photo metadata; the binary is uploaded separately (resumable block upload). */
  AttachPhoto: z.object({
    orderId: uuid,
    category: z.enum(['VORHER', 'NACHHER', 'TYPENSCHILD', 'BSZ', 'TEIL', 'SONSTIGES']),
    capturedAt: isoDateTime,
    width: z.number().int().positive().max(10_000),
    height: z.number().int().positive().max(10_000),
    sizeBytes: z.number().int().positive().max(25_000_000),
  }),
  /** Chat message; written offline, delivered in device order (PROMPT 5.8). */
  SendChatMessage: z
    .object({ orderId: uuid, body: z.string().max(4000).default(''), photoId: uuid.nullish() })
    .refine((v) => v.body.trim().length > 0 || !!v.photoId, { message: 'Nachricht ist leer' }),
  MarkChatRead: z.object({ orderId: uuid, upToServerSeq: z.number().int().nonnegative() }),
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
