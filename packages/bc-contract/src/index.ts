/**
 * Contract for all Business Central endpoints used by the Monteur-App.
 *
 * Single source of truth for the BC connector (api) and the BC mock (bc-mock).
 * Field names follow BC API conventions (camelCase, `id` = SystemId).
 * Endpoints under `standard` are BC API v2.0; endpoints under `werkstatt` are
 * custom API pages from /bc-extension (APIPublisher 'schroeder', APIGroup 'werkstatt', APIVersion 'v1.0').
 */
import { z } from 'zod';

const guid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** BC "Time" fields are serialized as "HH:mm:ss" (optionally with fraction). */
const isoTime = z.string().regex(/^\d{2}:\d{2}:\d{2}(\.\d+)?$/);
/** Empty GUID is what BC returns for a blank Guid field. */
export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

const base = { id: guid, lastModifiedDateTime: isoDateTime };

// ---------------------------------------------------------------------------
// Standard API v2.0
// ---------------------------------------------------------------------------

export const companySchema = z.object({ id: guid, name: z.string(), displayName: z.string() });

export const itemSchema = z.object({
  ...base,
  number: z.string(),
  displayName: z.string(),
  type: z.enum(['Inventory', 'Service', 'Non-Inventory']),
  itemCategoryCode: z.string(),
  baseUnitOfMeasureCode: z.string(),
  gtin: z.string(),
  inventory: z.number(),
  blocked: z.boolean(),
});

export const locationSchema = z.object({ ...base, code: z.string(), displayName: z.string() });

export const customerSchema = z.object({
  ...base,
  number: z.string(),
  displayName: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string(),
  city: z.string(),
  postalCode: z.string(),
  country: z.string(),
  phoneNumber: z.string(),
  email: z.string(),
});

export const employeeSchema = z.object({
  ...base,
  number: z.string(),
  displayName: z.string(),
  givenName: z.string(),
  surname: z.string(),
  status: z.enum(['Active', 'Inactive', 'Terminated']),
});

// ---------------------------------------------------------------------------
// Custom API pages (schroeder/werkstatt/v1.0)
// ---------------------------------------------------------------------------

/** BC Service Header status (table 5900, field Status). */
export const bcServiceStatus = z.enum(['Pending', 'In Process', 'Finished', 'On Hold']);
export type BcServiceStatus = z.infer<typeof bcServiceStatus>;

export const serviceOrderSchema = z.object({
  ...base,
  number: z.string(),
  description: z.string(),
  orderType: z.string(),
  status: bcServiceStatus,
  priority: z.enum(['Low', 'Medium', 'High']),
  orderDate: isoDate,
  responseDate: isoDate.nullable(),
  customerNumber: z.string(),
  customerName: z.string(),
  address: z.string(),
  address2: z.string(),
  postCode: z.string(),
  city: z.string(),
  countryCode: z.string(),
  contactName: z.string(),
  phoneNumber: z.string(),
  mobilePhoneNumber: z.string(),
  responsibilityCenter: z.string(),
  locationCode: z.string(),
  /** Free text from Service Order "Work Description" (blob, read-only). */
  workDescription: z.string(),
});

export const serviceOrderItemSchema = z.object({
  ...base,
  documentNumber: z.string(),
  lineNumber: z.number().int(),
  serviceItemNumber: z.string(),
  itemNumber: z.string(),
  serialNumber: z.string(),
  description: z.string(),
  faultComment: z.string(),
  repairStatusCode: z.string(),
});

export const serviceItemSchema = z.object({
  ...base,
  number: z.string(),
  description: z.string(),
  itemNumber: z.string(),
  serialNumber: z.string(),
  customerNumber: z.string(),
  serviceItemGroupCode: z.string(),
  /** Manufacturer code of the linked item, used as brand (e.g. FENDT). */
  manufacturerCode: z.string(),
  /** Operating hours; not a BC standard field (see OFFENE-PUNKTE OP-20). Null if unknown. */
  operatingHours: z.number().nullable(),
});

export const resourceSchema = z.object({
  ...base,
  number: z.string(),
  name: z.string(),
  type: z.enum(['Person', 'Machine']),
  resourceGroupNumber: z.string(),
  baseUnitOfMeasureCode: z.string(),
  blocked: z.boolean(),
});

export const serviceOrderTypeSchema = z.object({ ...base, code: z.string(), description: z.string() });

export const responsibilityCenterSchema = z.object({
  ...base,
  code: z.string(),
  name: z.string(),
  locationCode: z.string(),
});

export const causeOfAbsenceSchema = z.object({ ...base, code: z.string(), description: z.string() });

export const workTypeSchema = z.object({ ...base, code: z.string(), description: z.string() });

export const itemAvailabilitySchema = z.object({
  /** Synthetic id: SystemId of the item; one row per item and location. */
  itemId: guid,
  itemNumber: z.string(),
  locationCode: z.string(),
  inventory: z.number(),
  lastModifiedDateTime: isoDateTime,
});

export const itemReferenceSchema = z.object({
  ...base,
  itemNumber: z.string(),
  referenceType: z.enum(['Customer', 'Vendor', 'Bar Code', ' ']),
  referenceNumber: z.string(),
  unitOfMeasure: z.string(),
});

export const allocationStatus = z.enum([
  'Nonactive',
  'Active',
  'Finished',
  'Canceled',
  'Reallocation Needed',
]);

export const serviceOrderAllocationSchema = z.object({
  ...base,
  documentNumber: z.string(),
  serviceItemLineNumber: z.number().int(),
  resourceNumber: z.string(),
  allocationDate: isoDate,
  startingTime: isoTime,
  finishingTime: isoTime,
  allocatedHours: z.number(),
  status: allocationStatus,
  monteurAppId: guid,
});

export const serviceLineType = z.enum(['Item', 'Resource', 'Cost', 'G/L Account']);

export const serviceLineSchema = z.object({
  ...base,
  documentNumber: z.string(),
  lineNumber: z.number().int(),
  serviceItemLineNumber: z.number().int(),
  type: serviceLineType,
  number: z.string(),
  description: z.string(),
  quantity: z.number(),
  unitOfMeasureCode: z.string(),
  locationCode: z.string(),
  workTypeCode: z.string(),
  quantityShipped: z.number(),
  quantityConsumed: z.number(),
  quantityInvoiced: z.number(),
  monteurAppId: guid,
});

export const serviceCommentLineSchema = z.object({
  ...base,
  type: z.enum(['General', 'Fault', 'Resolution', 'Accessory', 'Internal', 'Service Item Loaner']),
  documentNumber: z.string(),
  serviceItemLineNumber: z.number().int(),
  lineNumber: z.number().int(),
  date: isoDate,
  comment: z.string().max(80),
  monteurAppId: guid,
});

export const employeeAbsenceSchema = z.object({
  ...base,
  entryNumber: z.number().int(),
  employeeNumber: z.string(),
  fromDate: isoDate,
  toDate: isoDate,
  causeOfAbsenceCode: z.string(),
  description: z.string(),
  quantity: z.number(),
  unitOfMeasureCode: z.string(),
  monteurAppId: guid,
});

export const resourceJournalLineSchema = z.object({
  ...base,
  journalTemplateName: z.string(),
  journalBatchName: z.string(),
  lineNumber: z.number().int(),
  postingDate: isoDate,
  documentNumber: z.string(),
  resourceNumber: z.string(),
  workTypeCode: z.string(),
  description: z.string(),
  quantity: z.number(),
  unitOfMeasureCode: z.string(),
  monteurAppId: guid,
});

export const itemJournalLineSchema = z.object({
  ...base,
  journalTemplateName: z.string(),
  journalBatchName: z.string(),
  lineNumber: z.number().int(),
  postingDate: isoDate,
  entryType: z.enum(['Negative Adjmt.', 'Positive Adjmt.']),
  documentNumber: z.string(),
  itemNumber: z.string(),
  locationCode: z.string(),
  quantity: z.number(),
  unitOfMeasureCode: z.string(),
  shortcutDimension1Code: z.string(),
  shortcutDimension2Code: z.string(),
  description: z.string(),
  monteurAppId: guid,
});

export const postedServiceInvoiceSchema = z.object({
  ...base,
  number: z.string(),
  orderNumber: z.string(),
  postingDate: isoDate,
  customerNumber: z.string(),
});

export const deletedRecordSchema = z.object({
  id: guid,
  tableNumber: z.number().int(),
  recordSystemId: guid,
  deletedAt: isoDateTime,
});

// ---------------------------------------------------------------------------
// Write payloads (POST bodies). Server-generated fields are omitted.
// ---------------------------------------------------------------------------

const omitServer = { id: true, lastModifiedDateTime: true } as const;

export const serviceLineCreateSchema = serviceLineSchema
  .omit({
    ...omitServer,
    lineNumber: true,
    quantityShipped: true,
    quantityConsumed: true,
    quantityInvoiced: true,
  })
  .extend({ description: z.string().optional(), workTypeCode: z.string().optional() });
export const serviceOrderAllocationCreateSchema = serviceOrderAllocationSchema.omit({
  ...omitServer,
  status: true,
});
export const serviceCommentLineCreateSchema = serviceCommentLineSchema.omit({
  ...omitServer,
  lineNumber: true,
});
export const employeeAbsenceCreateSchema = employeeAbsenceSchema.omit({ ...omitServer, entryNumber: true });
export const resourceJournalLineCreateSchema = resourceJournalLineSchema.omit({
  ...omitServer,
  lineNumber: true,
});
export const itemJournalLineCreateSchema = itemJournalLineSchema.omit({ ...omitServer, lineNumber: true });
export const serviceOrderStatusPatchSchema = z.object({ status: bcServiceStatus });

// ---------------------------------------------------------------------------
// Endpoint registry
// ---------------------------------------------------------------------------

export type ApiFamily = 'standard' | 'werkstatt';

export interface EndpointDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  family: ApiFamily;
  /** Entity set name as used in the URL. */
  entitySet: string;
  schema: S;
  /** Whether the entity supports delta sync via lastModifiedDateTime. */
  delta: boolean;
  /** Write operations allowed by the Monteur-App. */
  writable?: { create?: z.ZodTypeAny; patch?: z.ZodTypeAny };
}

const def = <S extends z.ZodTypeAny>(d: EndpointDef<S>) => d;

export const endpoints = {
  items: def({ family: 'standard', entitySet: 'items', schema: itemSchema, delta: true }),
  locations: def({ family: 'standard', entitySet: 'locations', schema: locationSchema, delta: true }),
  customers: def({ family: 'standard', entitySet: 'customers', schema: customerSchema, delta: true }),
  employees: def({ family: 'standard', entitySet: 'employees', schema: employeeSchema, delta: true }),

  serviceOrders: def({
    family: 'werkstatt',
    entitySet: 'serviceOrders',
    schema: serviceOrderSchema,
    delta: true,
    writable: { patch: serviceOrderStatusPatchSchema },
  }),
  serviceOrderItems: def({
    family: 'werkstatt',
    entitySet: 'serviceOrderItems',
    schema: serviceOrderItemSchema,
    delta: true,
  }),
  serviceItems: def({
    family: 'werkstatt',
    entitySet: 'serviceItems',
    schema: serviceItemSchema,
    delta: true,
  }),
  resources: def({ family: 'werkstatt', entitySet: 'resources', schema: resourceSchema, delta: true }),
  serviceOrderTypes: def({
    family: 'werkstatt',
    entitySet: 'serviceOrderTypes',
    schema: serviceOrderTypeSchema,
    delta: true,
  }),
  responsibilityCenters: def({
    family: 'werkstatt',
    entitySet: 'responsibilityCenters',
    schema: responsibilityCenterSchema,
    delta: true,
  }),
  causesOfAbsence: def({
    family: 'werkstatt',
    entitySet: 'causesOfAbsence',
    schema: causeOfAbsenceSchema,
    delta: true,
  }),
  workTypes: def({ family: 'werkstatt', entitySet: 'workTypes', schema: workTypeSchema, delta: true }),
  itemAvailabilities: def({
    family: 'werkstatt',
    entitySet: 'itemAvailabilities',
    schema: itemAvailabilitySchema,
    delta: false,
  }),
  itemReferences: def({
    family: 'werkstatt',
    entitySet: 'itemReferences',
    schema: itemReferenceSchema,
    delta: true,
  }),
  serviceOrderAllocations: def({
    family: 'werkstatt',
    entitySet: 'serviceOrderAllocations',
    schema: serviceOrderAllocationSchema,
    delta: true,
    writable: { create: serviceOrderAllocationCreateSchema },
  }),
  serviceLines: def({
    family: 'werkstatt',
    entitySet: 'serviceLines',
    schema: serviceLineSchema,
    delta: true,
    writable: { create: serviceLineCreateSchema },
  }),
  serviceCommentLines: def({
    family: 'werkstatt',
    entitySet: 'serviceCommentLines',
    schema: serviceCommentLineSchema,
    delta: true,
    writable: { create: serviceCommentLineCreateSchema },
  }),
  employeeAbsences: def({
    family: 'werkstatt',
    entitySet: 'employeeAbsences',
    schema: employeeAbsenceSchema,
    delta: true,
    writable: { create: employeeAbsenceCreateSchema },
  }),
  resourceJournalLines: def({
    family: 'werkstatt',
    entitySet: 'resourceJournalLines',
    schema: resourceJournalLineSchema,
    delta: false,
    writable: { create: resourceJournalLineCreateSchema },
  }),
  itemJournalLines: def({
    family: 'werkstatt',
    entitySet: 'itemJournalLines',
    schema: itemJournalLineSchema,
    delta: false,
    writable: { create: itemJournalLineCreateSchema },
  }),
  postedServiceInvoices: def({
    family: 'werkstatt',
    entitySet: 'postedServiceInvoices',
    schema: postedServiceInvoiceSchema,
    delta: true,
  }),
  deletedRecords: def({
    family: 'werkstatt',
    entitySet: 'deletedRecords',
    schema: deletedRecordSchema,
    delta: false,
  }),
} as const;

export type EndpointName = keyof typeof endpoints;
export type EntityOf<N extends EndpointName> = z.infer<(typeof endpoints)[N]['schema']>;

export const WERKSTATT_API = { publisher: 'schroeder', group: 'werkstatt', version: 'v1.0' } as const;

/** Path prefix of an entity set relative to the BC environment base URL (…/api). */
export function entityPath(name: EndpointName, companyId: string): string {
  const e = endpoints[name];
  const prefix =
    e.family === 'standard'
      ? 'v2.0'
      : `${WERKSTATT_API.publisher}/${WERKSTATT_API.group}/${WERKSTATT_API.version}`;
  return `${prefix}/companies(${companyId})/${e.entitySet}`;
}

/** BC OData error body. */
export const bcErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export type ServiceOrder = z.infer<typeof serviceOrderSchema>;
export type ServiceLine = z.infer<typeof serviceLineSchema>;
export type ServiceItem = z.infer<typeof serviceItemSchema>;
export type ServiceOrderAllocation = z.infer<typeof serviceOrderAllocationSchema>;
export type EmployeeAbsence = z.infer<typeof employeeAbsenceSchema>;
export type Item = z.infer<typeof itemSchema>;
