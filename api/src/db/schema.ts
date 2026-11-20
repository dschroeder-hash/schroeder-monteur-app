/**
 * Database schema (Drizzle). See docs/ARCHITEKTUR.md section 3.
 *
 * Conventions:
 *  - uuid primary keys (client-generated where records originate offline)
 *  - created_at / updated_at in UTC (server time)
 *  - row_version: global monotonically increasing version for delta pull (set by trigger, migration 0001)
 *  - RLS policies are defined in the hand-written migration drizzle/0001_rls.sql
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
/** PostgreSQL xid8 (transaction id), transported as string. */
const xid8 = customType<{ data: string; driverData: string }>({ dataType: () => 'xid8' });
const rowVersion = {
  rowVersion: bigint('row_version', { mode: 'number' }).notNull().default(0),
  /** Writing transaction; drives the gap-free delta pull (migration 0003, sync.service.ts). */
  txId: xid8('tx_id')
    .notNull()
    .default(sql`pg_current_xact_id()`),
};
const bcMirror = {
  bcSystemId: uuid('bc_system_id'),
  bcEtag: text('bc_etag'),
  bcModifiedAt: ts('bc_modified_at'),
};
const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const locationRoleEnum = pgEnum('location_role', ['MONTEUR', 'MEISTER', 'LAGER']);
export const appStatusEnum = pgEnum('app_status', [
  'NEU',
  'EINGEPLANT',
  'UNTERWEGS',
  'IN_ARBEIT',
  'WARTET_TEILE',
  'WARTET_KUNDE',
  'FERTIG_DOKU_OFFEN',
  'FERTIG',
  'FREIGEGEBEN',
  'ABGERECHNET',
]);
export const bcStatusEnum = pgEnum('bc_status', ['Pending', 'In Process', 'Finished', 'On Hold']);
export const stampKindEnum = pgEnum('stamp_kind', [
  'CLOCK_IN',
  'CLOCK_OUT',
  'JOB_START',
  'JOB_PAUSE',
  'JOB_STOP',
  'OVERHEAD_START',
  'OVERHEAD_STOP',
  'BREAK_START',
  'BREAK_STOP',
]);
export const activityEnum = pgEnum('activity', ['WORK', 'TRAVEL', 'DIAGNOSIS']);
export const timeEntryKindEnum = pgEnum('time_entry_kind', ['ATTENDANCE', 'ORDER', 'OVERHEAD', 'BREAK']);
export const approvalStateEnum = pgEnum('approval_state', [
  'OPEN',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'TRANSFERRED',
]);
export const absenceTypeEnum = pgEnum('absence_type', ['KRANK', 'URLAUB']);
export const absenceStateEnum = pgEnum('absence_state', [
  'REPORTED',
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'CANCEL_REQUESTED',
  'CANCELLED',
]);
export const halfDayEnum = pgEnum('half_day', ['NONE', 'AM', 'PM']);
export const containerKindEnum = pgEnum('container_kind', ['FASS', 'IBC', 'TANK', 'KANISTER', 'KARTUSCHE']);
export const storageKindEnum = pgEnum('storage_kind', ['LAGER', 'SERVICEWAGEN', 'TANK']);
export const photoCategoryEnum = pgEnum('photo_category', [
  'VORHER',
  'NACHHER',
  'TYPENSCHILD',
  'BSZ',
  'TEIL',
  'SONSTIGES',
]);
export const uploadStateEnum = pgEnum('upload_state', ['PENDING', 'UPLOADED', 'FAILED']);
export const partRequestStateEnum = pgEnum('part_request_state', [
  'OFFEN',
  'BESTELLT',
  'GELIEFERT',
  'STORNIERT',
]);
export const transferStateEnum = pgEnum('transfer_state', [
  'PENDING',
  'IN_PROGRESS',
  'DONE',
  'FAILED',
  'DEAD',
]);
export const transferTargetEnum = pgEnum('transfer_target', [
  'SERVICE_LINE_RESOURCE',
  'SERVICE_LINE_ITEM',
  'RESOURCE_JOURNAL',
  'ITEM_JOURNAL',
  'ALLOCATION',
  'COMMENT',
  'ABSENCE',
  'STATUS',
  'ATTACHMENT',
]);
export const productivityCategoryEnum = pgEnum('productivity_category', [
  'KUNDENSERVICE',
  'WARTUNG_KUNDE',
  'WARTUNG_INTERN',
  'GARANTIE_KULANZ',
  'INTERN_SONSTIGE',
  'NACHARBEIT',
]);

// ---------------------------------------------------------------------------
// Organisation & users
// ---------------------------------------------------------------------------

export const location = pgTable('location', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  /** ISO 3166-2 subdivision without country prefix, e.g. NI, RP (holidays). */
  bundesland: text('bundesland').notNull(),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  bcCompanyId: uuid('bc_company_id').notNull(),
  bcResponsibilityCenter: text('bc_responsibility_center').notNull(),
  defaultLocationCode: text('default_location_code').notNull(),
  active: boolean('active').notNull().default(true),
  ...timestamps,
  ...rowVersion,
});

export const storageLocation = pgTable(
  'storage_location',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    bcLocationCode: text('bc_location_code').notNull(),
    name: text('name').notNull(),
    kind: storageKindEnum('kind').notNull(),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [uniqueIndex('storage_location_code_uq').on(t.locationId, t.bcLocationCode)],
);

export const appUser = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Entra object id (oid claim). */
  entraOid: uuid('entra_oid').notNull().unique(),
  displayName: text('display_name').notNull(),
  email: text('email').notNull(),
  isApprentice: boolean('is_apprentice').notNull().default(false),
  active: boolean('active').notNull().default(true),
  /** Entra app roles seen at the last sign-in (e.g. to notify Personal, which has no location grant). */
  roles: text('roles')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  ...timestamps,
  ...rowVersion,
});

export const userLocation = pgTable(
  'user_location',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    role: locationRoleEnum('role').notNull(),
    serviceVanStorageId: uuid('service_van_storage_id').references(() => storageLocation.id),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId, t.role] })],
);

export const bcResourceMapping = pgTable(
  'bc_resource_mapping',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => appUser.id),
    bcCompanyId: uuid('bc_company_id').notNull(),
    bcResourceNo: text('bc_resource_no').notNull(),
    bcEmployeeNo: text('bc_employee_no'),
    ...timestamps,
  },
  (t) => [uniqueIndex('bc_resource_mapping_res_uq').on(t.bcCompanyId, t.bcResourceNo)],
);

export const featureFlag = pgTable(
  'feature_flag',
  {
    /** null location = global default for all locations */
    locationId: uuid('location_id').references(() => location.id),
    feature: text('feature').notNull(),
    enabled: boolean('enabled').notNull(),
    changedBy: uuid('changed_by').references(() => appUser.id),
    note: text('note'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('feature_flag_uq').on(
      sql`coalesce(${t.locationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.feature,
    ),
  ],
);

/** Key/value settings, optionally per location (rounding, reminder time, retention, targets …). */
export const setting = pgTable(
  'setting',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id').references(() => location.id),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [
    uniqueIndex('setting_uq').on(
      sql`coalesce(${t.locationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.key,
    ),
  ],
);

// ---------------------------------------------------------------------------
// BC mirror: customers, machines, items, order types
// ---------------------------------------------------------------------------

export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bcCompanyId: uuid('bc_company_id').notNull(),
    number: text('number').notNull(),
    name: text('name').notNull(),
    address: text('address').notNull().default(''),
    postCode: text('post_code').notNull().default(''),
    city: text('city').notNull().default(''),
    phone: text('phone').notNull().default(''),
    ...bcMirror,
    ...timestamps,
    ...rowVersion,
  },
  (t) => [uniqueIndex('customer_no_uq').on(t.bcCompanyId, t.number)],
);

export const machine = pgTable(
  'machine',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bcCompanyId: uuid('bc_company_id').notNull(),
    serviceItemNo: text('service_item_no').notNull(),
    brand: text('brand').notNull().default(''),
    model: text('model').notNull().default(''),
    serialNo: text('serial_no').notNull().default(''),
    machineGroup: text('machine_group').notNull().default(''),
    operatingHours: numeric('operating_hours', { precision: 10, scale: 1, mode: 'number' }),
    customerNo: text('customer_no').notNull().default(''),
    ...bcMirror,
    ...timestamps,
    ...rowVersion,
  },
  (t) => [uniqueIndex('machine_no_uq').on(t.bcCompanyId, t.serviceItemNo)],
);

export const orderType = pgTable(
  'order_type',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bcCompanyId: uuid('bc_company_id').notNull(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    ...bcMirror,
    ...timestamps,
    ...rowVersion,
  },
  (t) => [uniqueIndex('order_type_uq').on(t.bcCompanyId, t.code)],
);

/** Versioned mapping BC order type → productivity category (E-23). */
export const orderTypeMapping = pgTable(
  'order_type_mapping',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderTypeCode: text('order_type_code').notNull(),
    category: productivityCategoryEnum('category').notNull(),
    productive: boolean('productive').notNull(),
    external: boolean('external').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    changedBy: uuid('changed_by').references(() => appUser.id),
    ...timestamps,
  },
  (t) => [uniqueIndex('order_type_mapping_uq').on(t.orderTypeCode, t.validFrom)],
);

export const item = pgTable(
  'item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bcCompanyId: uuid('bc_company_id').notNull(),
    number: text('number').notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    category: text('category').notNull().default(''),
    gtin: text('gtin').notNull().default(''),
    blocked: boolean('blocked').notNull().default(false),
    isConsumable: boolean('is_consumable').notNull().default(false),
    imageUrl: text('image_url'),
    ...bcMirror,
    ...timestamps,
    ...rowVersion,
  },
  (t) => [
    uniqueIndex('item_no_uq').on(t.bcCompanyId, t.number),
    index('item_gtin_idx').on(t.gtin),
    index('item_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

export const itemBarcode = pgTable(
  'item_barcode',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    code: text('code').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.itemId, t.code] }), index('item_barcode_code_idx').on(t.code)],
);

export const itemStock = pgTable(
  'item_stock',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    storageLocationId: uuid('storage_location_id')
      .notNull()
      .references(() => storageLocation.id),
    /** Inventory according to BC (posted). */
    bcInventory: qty('bc_inventory').notNull().default(0),
    /** App withdrawals not yet posted in BC (E-16). */
    pendingWithdrawal: qty('pending_withdrawal').notNull().default(0),
    minStock: qty('min_stock'),
    bcModifiedAt: ts('bc_modified_at'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [primaryKey({ columns: [t.itemId, t.storageLocationId] })],
);

export const container = pgTable('container', {
  id: uuid('id').primaryKey().defaultRandom(),
  locationId: uuid('location_id')
    .notNull()
    .references(() => location.id),
  storageLocationId: uuid('storage_location_id')
    .notNull()
    .references(() => storageLocation.id),
  itemId: uuid('item_id')
    .notNull()
    .references(() => item.id),
  kind: containerKindEnum('kind').notNull(),
  name: text('name').notNull(),
  capacity: qty('capacity'),
  minStock: qty('min_stock'),
  hasMeter: boolean('has_meter').notNull().default(false),
  quickQuantities: jsonb('quick_quantities').$type<number[]>().notNull().default([5, 10, 20, 40]),
  active: boolean('active').notNull().default(true),
  ...timestamps,
  ...rowVersion,
});

export const overheadType = pgTable('overhead_type', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  /** Counts as attendance for productivity (false for training and ordered special tasks). */
  countsAsAttendance: boolean('counts_as_attendance').notNull().default(true),
  active: boolean('active').notNull().default(true),
  ...timestamps,
  ...rowVersion,
});

// ---------------------------------------------------------------------------
// Service orders & planning
// ---------------------------------------------------------------------------

export const serviceOrder = pgTable(
  'service_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    bcCompanyId: uuid('bc_company_id').notNull(),
    bcNo: text('bc_no').notNull(),
    description: text('description').notNull().default(''),
    orderTypeCode: text('order_type_code').notNull(),
    bcStatus: bcStatusEnum('bc_status').notNull(),
    appStatus: appStatusEnum('app_status').notNull().default('NEU'),
    priority: text('priority').notNull().default('Medium'),
    orderDate: date('order_date', { mode: 'string' }),
    responseDate: date('response_date', { mode: 'string' }),
    customerNo: text('customer_no').notNull().default(''),
    customerName: text('customer_name').notNull().default(''),
    address: jsonb('address').$type<{
      street: string;
      street2: string;
      postCode: string;
      city: string;
      country: string;
    }>(),
    contactName: text('contact_name').notNull().default(''),
    contactPhone: text('contact_phone').notNull().default(''),
    contactMobile: text('contact_mobile').notNull().default(''),
    faultDescription: text('fault_description').notNull().default(''),
    reworkFlag: boolean('rework_flag').notNull().default(false),
    billedAt: ts('billed_at'),
    deletedInBcAt: ts('deleted_in_bc_at'),
    ...bcMirror,
    ...timestamps,
    ...rowVersion,
  },
  (t) => [
    uniqueIndex('service_order_no_uq').on(t.bcCompanyId, t.bcNo),
    index('service_order_location_idx').on(t.locationId, t.appStatus),
  ],
);

export const serviceOrderItem = pgTable(
  'service_order_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => serviceOrder.id),
    lineNo: integer('line_no').notNull(),
    machineId: uuid('machine_id').references(() => machine.id),
    description: text('description').notNull().default(''),
    faultComment: text('fault_comment').notNull().default(''),
    ...bcMirror,
    ...timestamps,
    ...rowVersion,
  },
  (t) => [uniqueIndex('service_order_item_uq').on(t.orderId, t.lineNo)],
);

export const assignment = pgTable(
  'assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => serviceOrder.id),
    orderItemLineNo: integer('order_item_line_no').notNull().default(10000),
    /** Denormalised from service_order to keep RLS policies non-recursive. */
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    plannedStart: ts('planned_start').notNull(),
    plannedEnd: ts('planned_end').notNull(),
    conflictState: text('conflict_state').notNull().default('ok'),
    needsReplan: boolean('needs_replan').notNull().default(false),
    createdBy: uuid('created_by').references(() => appUser.id),
    cancelledAt: ts('cancelled_at'),
    bcAllocationId: uuid('bc_allocation_id'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [
    index('assignment_user_idx').on(t.userId, t.plannedStart),
    index('assignment_order_idx').on(t.orderId),
  ],
);

export const orderStatusEvent = pgTable(
  'order_status_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => serviceOrder.id),
    fromStatus: appStatusEnum('from_status'),
    toStatus: appStatusEnum('to_status').notNull(),
    actorId: uuid('actor_id').references(() => appUser.id),
    source: text('source').notNull(),
    note: text('note'),
    deviceTime: ts('device_time'),
    at: ts('at').notNull().defaultNow(),
    ...rowVersion,
  },
  (t) => [index('order_status_event_order_idx').on(t.orderId, t.at)],
);

// ---------------------------------------------------------------------------
// Time tracking
// ---------------------------------------------------------------------------

export const stampEvent = pgTable(
  'stamp_event',
  {
    /** Client-generated id. */
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    kind: stampKindEnum('kind').notNull(),
    orderId: uuid('order_id').references(() => serviceOrder.id),
    activity: activityEnum('activity'),
    overheadCode: text('overhead_code').references(() => overheadType.code),
    deviceTime: ts('device_time').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    clockSkewMs: integer('clock_skew_ms'),
    skewFlag: boolean('skew_flag').notNull().default(false),
    implicit: boolean('implicit').notNull().default(false),
    deviceId: text('device_id'),
    /** Set when a Meister added the event as a correction (null = stamped by the Monteur). */
    createdBy: uuid('created_by').references(() => appUser.id),
    correctionReason: text('correction_reason'),
    ...rowVersion,
  },
  (t) => [index('stamp_event_user_idx').on(t.userId, t.deviceTime)],
);

/** Correction: a stamp event is voided (never deleted or changed – E-07). */
export const stampEventVoid = pgTable('stamp_event_void', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => stampEvent.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => appUser.id),
  voidedBy: uuid('voided_by')
    .notNull()
    .references(() => appUser.id),
  reason: text('reason').notNull(),
  at: ts('at').notNull().defaultNow(),
});

export const correctionStateEnum = pgEnum('correction_state', ['OFFEN', 'ANGENOMMEN', 'ABGELEHNT']);

/** Correction requested by the Monteur (e.g. forgotten clock-out), decided by the Meister (PROMPT 5.1). */
export const timeCorrectionRequest = pgTable(
  'time_correction_request',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    /** Proposed additional events, e.g. [{ kind: 'CLOCK_OUT', time: '16:30' }] (local time). */
    proposal: jsonb('proposal')
      .$type<Array<{ kind: string; time: string; orderId?: string | null; activity?: string | null }>>()
      .notNull(),
    comment: text('comment'),
    state: correctionStateEnum('state').notNull().default('OFFEN'),
    decidedBy: uuid('decided_by').references(() => appUser.id),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [index('time_correction_request_loc_idx').on(t.locationId, t.state)],
);

export const timeEntry = pgTable(
  'time_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    kind: timeEntryKindEnum('kind').notNull(),
    orderId: uuid('order_id').references(() => serviceOrder.id),
    activity: activityEnum('activity'),
    overheadCode: text('overhead_code').references(() => overheadType.code),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at'),
    actualMinutes: integer('actual_minutes'),
    billableMinutes: integer('billable_minutes'),
    state: approvalStateEnum('state').notNull().default('OPEN'),
    needsCorrection: boolean('needs_correction').notNull().default(false),
    skewFlag: boolean('skew_flag').notNull().default(false),
    approvalId: uuid('approval_id'),
    /** Deterministic key of the derived segment (opening stamp event id + kind); null for manual corrections. */
    segmentKey: text('segment_key'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [
    index('time_entry_user_date_idx').on(t.userId, t.workDate),
    index('time_entry_order_idx').on(t.orderId),
    uniqueIndex('time_entry_segment_uq').on(t.userId, t.segmentKey),
  ],
);

export const timeEntryRevision = pgTable('time_entry_revision', {
  id: uuid('id').primaryKey().defaultRandom(),
  timeEntryId: uuid('time_entry_id')
    .notNull()
    .references(() => timeEntry.id),
  oldValue: jsonb('old_value').notNull(),
  newValue: jsonb('new_value').notNull(),
  reason: text('reason').notNull(),
  changedBy: uuid('changed_by')
    .notNull()
    .references(() => appUser.id),
  at: ts('at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

export const consumption = pgTable(
  'consumption',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    orderId: uuid('order_id').references(() => serviceOrder.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => item.id),
    storageLocationId: uuid('storage_location_id')
      .notNull()
      .references(() => storageLocation.id),
    containerId: uuid('container_id').references(() => container.id),
    quantity: qty('quantity').notNull(),
    unit: text('unit').notNull(),
    /** Internal dispense only (diesel for service van / demo machine). */
    costCenter: text('cost_center'),
    internalPurpose: text('internal_purpose'),
    meterBefore: qty('meter_before'),
    meterAfter: qty('meter_after'),
    deviceTime: ts('device_time').notNull(),
    state: approvalStateEnum('state').notNull().default('SUBMITTED'),
    bcPostedQty: qty('bc_posted_qty').notNull().default(0),
    stockConflict: boolean('stock_conflict').notNull().default(false),
    approvalId: uuid('approval_id'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [index('consumption_order_idx').on(t.orderId)],
);

export const partRequest = pgTable('part_request', {
  id: uuid('id').primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => serviceOrder.id),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => appUser.id),
  locationId: uuid('location_id')
    .notNull()
    .references(() => location.id),
  itemId: uuid('item_id').references(() => item.id),
  /** Free text for part numbers not in BC ("Neuer Artikel – Anfrage ans Lager"). */
  newItemText: text('new_item_text'),
  manufacturerPartNo: text('manufacturer_part_no'),
  quantity: qty('quantity').notNull(),
  sourceBcLocationCode: text('source_bc_location_code'),
  expectedDelivery: date('expected_delivery', { mode: 'string' }),
  state: partRequestStateEnum('state').notNull().default('OFFEN'),
  ...timestamps,
  ...rowVersion,
});

// ---------------------------------------------------------------------------
// Documentation, photos, chat
// ---------------------------------------------------------------------------

export const textTemplate = pgTable('text_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  locationId: uuid('location_id').references(() => location.id),
  orderTypeCode: text('order_type_code'),
  machineGroup: text('machine_group'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps,
  ...rowVersion,
});

export const workReport = pgTable('work_report', {
  id: uuid('id').primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .unique()
    .references(() => serviceOrder.id),
  authorId: uuid('author_id')
    .notNull()
    .references(() => appUser.id),
  body: text('body').notNull().default(''),
  requiredFields: jsonb('required_fields')
    .$type<Record<string, string | number | null>>()
    .notNull()
    .default({}),
  usedTemplateIds: jsonb('used_template_ids').$type<string[]>().notNull().default([]),
  complete: boolean('complete').notNull().default(false),
  completedAt: ts('completed_at'),
  deviceTime: ts('device_time'),
  state: approvalStateEnum('state').notNull().default('OPEN'),
  approvalId: uuid('approval_id'),
  ...timestamps,
  ...rowVersion,
});

export const photo = pgTable(
  'photo',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => serviceOrder.id),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => appUser.id),
    category: photoCategoryEnum('category').notNull(),
    blobPath: text('blob_path').notNull(),
    contentType: text('content_type').notNull().default('image/jpeg'),
    sizeBytes: integer('size_bytes'),
    width: integer('width'),
    height: integer('height'),
    capturedAt: ts('captured_at'),
    uploadState: uploadStateEnum('upload_state').notNull().default('PENDING'),
    /** Blocks already received by the local storage adapter (resumable upload); unused with Azure Blob. */
    uploadedAt: ts('uploaded_at'),
    deletedAt: ts('deleted_at'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [index('photo_order_idx').on(t.orderId)],
);

export const chatMessage = pgTable(
  'chat_message',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => serviceOrder.id),
    authorId: uuid('author_id').references(() => appUser.id),
    serverSeq: bigserial('server_seq', { mode: 'number' }).notNull(),
    clientSeq: integer('client_seq'),
    clientCreatedAt: ts('client_created_at'),
    body: text('body').notNull(),
    photoId: uuid('photo_id').references(() => photo.id),
    isSystem: boolean('is_system').notNull().default(false),
    deletedAt: ts('deleted_at'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [index('chat_message_order_idx').on(t.orderId, t.serverSeq)],
);

export const chatRead = pgTable(
  'chat_read',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessage.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    readAt: ts('read_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

// ---------------------------------------------------------------------------
// Absences
// ---------------------------------------------------------------------------

export const absence = pgTable(
  'absence',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    type: absenceTypeEnum('type').notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }),
    halfDay: halfDayEnum('half_day').notNull().default('NONE'),
    state: absenceStateEnum('state').notNull(),
    /** Optional comment. Never a diagnosis (UI hint + DATENSCHUTZ.md). */
    comment: text('comment'),
    decisionReason: text('decision_reason'),
    decidedBy: uuid('decided_by').references(() => appUser.id),
    decidedAt: ts('decided_at'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [
    index('absence_user_idx').on(t.userId, t.fromDate),
    index('absence_location_idx').on(t.locationId, t.fromDate),
  ],
);

/**
 * Team calendar (PROMPT 5.10): colleagues see that someone is absent, never why. Mirror of active absences
 * without type and comment, maintained by a trigger on `absence` (migration 0009).
 */
export const teamAbsence = pgTable(
  'team_absence',
  {
    absenceId: uuid('absence_id')
      .primaryKey()
      .references(() => absence.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }),
    halfDay: halfDayEnum('half_day').notNull().default('NONE'),
  },
  (t) => [index('team_absence_location_idx').on(t.locationId, t.fromDate)],
);

export const vacationBalance = pgTable(
  'vacation_balance',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    year: integer('year').notNull(),
    entitlementDays: numeric('entitlement_days', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    carryOverDays: numeric('carry_over_days', { precision: 5, scale: 1, mode: 'number' })
      .notNull()
      .default(0),
    source: text('source').notNull().default('APP'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [primaryKey({ columns: [t.userId, t.year] })],
);

// ---------------------------------------------------------------------------
// Approvals, BC transfer, sync, audit
// ---------------------------------------------------------------------------

export const approval = pgTable('approval', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  decision: text('decision').notNull(),
  reason: text('reason'),
  approvedBy: uuid('approved_by')
    .notNull()
    .references(() => appUser.id),
  approvedAt: ts('approved_at').notNull().defaultNow(),
});

export const bcTransfer = pgTable(
  'bc_transfer',
  {
    /** Idempotency key, stored in BC as "Monteur App Id". */
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id').references(() => location.id),
    bcCompanyId: uuid('bc_company_id').notNull(),
    target: transferTargetEnum('target').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** Ordering group: transfers of the same group are processed in sequence (e.g. one service order). */
    groupKey: text('group_key').notNull(),
    payload: jsonb('payload').notNull(),
    state: transferStateEnum('state').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    lastError: text('last_error'),
    bcRecordId: uuid('bc_record_id'),
    lockedAt: ts('locked_at'),
    ...timestamps,
  },
  (t) => [
    index('bc_transfer_due_idx').on(t.state, t.nextAttemptAt),
    index('bc_transfer_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

export const bcSyncCursor = pgTable(
  'bc_sync_cursor',
  {
    bcCompanyId: uuid('bc_company_id').notNull(),
    entity: text('entity').notNull(),
    lastModified: ts('last_modified'),
    lastRunAt: ts('last_run_at'),
    lastError: text('last_error'),
  },
  (t) => [primaryKey({ columns: [t.bcCompanyId, t.entity] })],
);

/** Idempotent inbox for offline commands (E-06). */
export const syncCommand = pgTable(
  'sync_command',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    deviceId: text('device_id').notNull(),
    deviceSeq: integer('device_seq').notNull(),
    type: text('type').notNull(),
    deviceTime: ts('device_time').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    result: text('result').notNull(),
    resultDetail: jsonb('result_detail'),
  },
  (t) => [index('sync_command_user_idx').on(t.userId, t.receivedAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id').references(() => appUser.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    reason: text('reason'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId)],
);

export const pushSubscription = pgTable(
  'push_subscription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  // One row per user and browser; on a shared device the newest sign-in wins (worker, deliverPush).
  (t) => [uniqueIndex('push_subscription_user_endpoint_uq').on(t.userId, t.endpoint)],
);

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: ts('read_at'),
    /** Web Push delivery (worker); null = not yet pushed. */
    pushedAt: ts('pushed_at'),
    ...timestamps,
    ...rowVersion,
  },
  (t) => [index('notification_user_idx').on(t.userId, t.createdAt)],
);

export const productivitySnapshot = pgTable(
  'productivity_snapshot',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id),
    month: date('month', { mode: 'string' }).notNull(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    result: jsonb('result').notNull(),
    mappingVersion: text('mapping_version').notNull(),
    configHash: text('config_hash').notNull(),
    calculatedAt: ts('calculated_at').notNull().defaultNow(),
    ...rowVersion,
  },
  (t) => [primaryKey({ columns: [t.userId, t.month] })],
);

/** "Aus BC aktualisieren": a user asks for one order to be re-read from BC now; the worker processes it (E-61). */
export const bcRefreshRequest = pgTable(
  'bc_refresh_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => serviceOrder.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => appUser.id),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    doneAt: ts('done_at'),
    error: text('error'),
  },
  (t) => [index('bc_refresh_request_open_idx').on(t.doneAt, t.requestedAt)],
);

/** Tables that get the row_version trigger (delta pull). */
export const VERSIONED_TABLES = [
  'location',
  'storage_location',
  'app_user',
  'setting',
  'customer',
  'machine',
  'order_type',
  'item',
  'item_stock',
  'container',
  'overhead_type',
  'service_order',
  'service_order_item',
  'assignment',
  'order_status_event',
  'stamp_event',
  'time_entry',
  'consumption',
  'part_request',
  'text_template',
  'work_report',
  'photo',
  'chat_message',
  'absence',
  'vacation_balance',
  'notification',
  'productivity_snapshot',
] as const;

/**
 * Service checklists (E-67): templates from BC's checklist layout (maintained by Admin, imported as JSON), one
 * filled-in checklist per order. Item kinds: check (OK / not OK / n. a.), value (number with unit), text.
 */
export interface ChecklistItemDef {
  id: string;
  text: string;
  kind: 'check' | 'value' | 'text';
  unit?: string | null;
  required?: boolean;
  section?: string | null;
}
export interface ChecklistResult {
  state: 'OK' | 'NOK' | 'NA' | null;
  value: string | null;
  note: string;
}
export const checklistTemplate = pgTable('checklist_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  locationId: uuid('location_id').references(() => location.id),
  title: text('title').notNull(),
  /** null = for all order types / brands. */
  orderTypeCode: text('order_type_code'),
  brand: text('brand'),
  items: jsonb('items').$type<ChecklistItemDef[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  ...timestamps,
  ...rowVersion,
});

export const orderChecklist = pgTable('order_checklist', {
  id: uuid('id').primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .unique()
    .references(() => serviceOrder.id),
  templateId: uuid('template_id')
    .notNull()
    .references(() => checklistTemplate.id),
  authorId: uuid('author_id')
    .notNull()
    .references(() => appUser.id),
  results: jsonb('results').$type<Record<string, ChecklistResult>>().notNull().default({}),
  complete: boolean('complete').notNull().default(false),
  deviceTime: ts('device_time'),
  ...timestamps,
  ...rowVersion,
});

/** Customer signature on the workshop order (E-68): PNG (data URL) or the reason why nobody could sign. */
export const orderSignature = pgTable('order_signature', {
  orderId: uuid('order_id')
    .primaryKey()
    .references(() => serviceOrder.id),
  authorId: uuid('author_id')
    .notNull()
    .references(() => appUser.id),
  signerName: text('signer_name').notNull().default(''),
  signedAt: ts('signed_at').notNull(),
  imagePng: text('image_png'),
  absentReason: text('absent_reason'),
  deviceTime: ts('device_time'),
  ...timestamps,
  ...rowVersion,
});
