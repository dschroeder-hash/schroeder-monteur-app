import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { appStatusFromBc, DEFAULT_CONSUMABLE_CATEGORIES, type BcServiceStatus } from '@schroeder/shared';
import { buildSeed, SEED_COMPANY, SEED_LOCATIONS } from '@schroeder/bc-mock';
import { createDb, type Db } from '../db/client.js';
import * as s from '../db/schema.js';
import { DEV_PERSONAS } from './personas.js';

/** Default productivity mapping (PROMPT 5.11, configurable; OFFENE-PUNKTE OP-02). */
export const DEFAULT_ORDER_TYPE_MAPPING = [
  { orderTypeCode: 'KUNDE', category: 'KUNDENSERVICE', productive: true, external: true },
  { orderTypeCode: 'KLEING', category: 'KUNDENSERVICE', productive: true, external: true },
  { orderTypeCode: 'WARTUNG', category: 'WARTUNG_KUNDE', productive: true, external: true },
  { orderTypeCode: 'INTWART', category: 'WARTUNG_INTERN', productive: true, external: false },
  { orderTypeCode: 'GARANTIE', category: 'GARANTIE_KULANZ', productive: true, external: true },
  { orderTypeCode: 'KULANZ', category: 'GARANTIE_KULANZ', productive: true, external: false },
  { orderTypeCode: 'GEBR', category: 'INTERN_SONSTIGE', productive: false, external: false },
  { orderTypeCode: 'UEBERGABE', category: 'INTERN_SONSTIGE', productive: false, external: false },
] as const;

export const DEFAULT_OVERHEAD_TYPES = [
  { code: 'WERKSTATTPFLEGE', label: 'Werkstattpflege', countsAsAttendance: true },
  { code: 'SCHULUNG', label: 'Schulung', countsAsAttendance: false },
  { code: 'WARTEN_TEILE', label: 'Warten auf Teile', countsAsAttendance: true },
  { code: 'SONDERAUFGABE', label: 'Sonderaufgabe (angeordnet)', countsAsAttendance: false },
];

/**
 * Seeds master data, personas and service orders for dev/test.
 * Must run as schema owner (bypasses RLS). Idempotent: truncates all app tables first.
 */
export async function seedDev(db: Db, now = new Date()): Promise<void> {
  const tables = Object.values(s).filter(
    (t): t is typeof s.location => typeof t === 'object' && t !== null && Symbol.for('drizzle:Name') in t,
  );
  const names = tables.map(
    (t) => `"${(t as unknown as Record<symbol, string>)[Symbol.for('drizzle:Name')]}"`,
  );
  await db.execute(sql.raw(`TRUNCATE ${names.join(', ')} RESTART IDENTITY CASCADE`));

  const bc = buildSeed(now);
  const locIds = new Map<string, string>();
  for (const l of SEED_LOCATIONS) {
    const [row] = await db
      .insert(s.location)
      .values({
        code: l.code,
        name: l.name,
        bundesland: l.bundesland,
        bcCompanyId: SEED_COMPANY.id,
        bcResponsibilityCenter: l.code,
        defaultLocationCode: l.warehouse,
      })
      .returning();
    locIds.set(l.code, row!.id);
    await db.insert(s.storageLocation).values([
      { locationId: row!.id, bcLocationCode: l.warehouse, name: `Lager ${l.name}`, kind: 'LAGER' as const },
      { locationId: row!.id, bcLocationCode: l.tank, name: `Tankanlage ${l.name}`, kind: 'TANK' as const },
      ...l.vans.map((v, i) => ({
        locationId: row!.id,
        bcLocationCode: v,
        name: `Servicewagen ${i + 1}`,
        kind: 'SERVICEWAGEN' as const,
      })),
    ]);
  }

  const userIds = new Map<string, string>();
  const resourceToUser = new Map<string, string>();
  for (const p of DEV_PERSONAS) {
    const [u] = await db
      .insert(s.appUser)
      .values({ entraOid: p.oid, displayName: p.name, email: p.email, isApprentice: p.isApprentice ?? false })
      .returning();
    userIds.set(p.key, u!.id);
    for (const g of p.locations)
      await db
        .insert(s.userLocation)
        .values({ userId: u!.id, locationId: locIds.get(g.code)!, role: g.role });
    if (p.bcResourceNo) {
      await db.insert(s.bcResourceMapping).values({
        userId: u!.id,
        bcCompanyId: SEED_COMPANY.id,
        bcResourceNo: p.bcResourceNo,
        bcEmployeeNo: p.bcEmployeeNo ?? null,
      });
      resourceToUser.set(p.bcResourceNo, u!.id);
    }
  }

  await db.insert(s.orderType).values(
    bc.serviceOrderTypes.map((t) => ({
      bcCompanyId: SEED_COMPANY.id,
      code: String(t.code),
      description: String(t.description),
      bcSystemId: String(t.id),
    })),
  );
  await db
    .insert(s.orderTypeMapping)
    .values(DEFAULT_ORDER_TYPE_MAPPING.map((m) => ({ ...m, validFrom: '2020-01-01' })));
  await db.insert(s.overheadType).values(DEFAULT_OVERHEAD_TYPES);

  const custByNo = new Map(bc.customers.map((c) => [String(c.number), c]));
  for (const c of bc.customers)
    await db.insert(s.customer).values({
      bcCompanyId: SEED_COMPANY.id,
      number: String(c.number),
      name: String(c.displayName),
      address: String(c.addressLine1),
      postCode: String(c.postalCode),
      city: String(c.city),
      phone: String(c.phoneNumber),
      bcSystemId: String(c.id),
    });

  const machineIds = new Map<string, string>();
  for (const si of bc.serviceItems) {
    const [m] = await db
      .insert(s.machine)
      .values({
        bcCompanyId: SEED_COMPANY.id,
        serviceItemNo: String(si.number),
        brand: String(si.manufacturerCode),
        model: String(si.description),
        serialNo: String(si.serialNumber),
        machineGroup: String(si.serviceItemGroupCode),
        operatingHours: si.operatingHours as number | null,
        customerNo: String(si.customerNumber),
        bcSystemId: String(si.id),
      })
      .returning();
    machineIds.set(String(si.number), m!.id);
  }

  const orderIds = new Map<string, { id: string; locationId: string }>();
  for (const o of bc.serviceOrders) {
    const locationId = locIds.get(String(o.responsibilityCenter))!;
    const soi = bc.serviceOrderItems.find((i) => i.documentNumber === o.number);
    const [row] = await db
      .insert(s.serviceOrder)
      .values({
        locationId,
        bcCompanyId: SEED_COMPANY.id,
        bcNo: String(o.number),
        description: String(o.description),
        orderTypeCode: String(o.orderType),
        bcStatus: o.status as BcServiceStatus,
        appStatus: appStatusFromBc(o.status as BcServiceStatus),
        priority: String(o.priority),
        orderDate: o.orderDate as string,
        responseDate: (o.responseDate as string | null) ?? null,
        customerNo: String(o.customerNumber),
        customerName: String(o.customerName),
        address: {
          street: String(o.address),
          street2: String(o.address2),
          postCode: String(o.postCode),
          city: String(o.city),
          country: String(o.countryCode),
        },
        contactName: String(o.contactName),
        contactPhone: String(o.phoneNumber || custByNo.get(String(o.customerNumber))?.phoneNumber || ''),
        contactMobile: String(o.mobilePhoneNumber),
        faultDescription: String(soi?.faultComment ?? ''),
        bcSystemId: String(o.id),
      })
      .returning();
    orderIds.set(String(o.number), { id: row!.id, locationId });
    if (soi)
      await db.insert(s.serviceOrderItem).values({
        orderId: row!.id,
        lineNo: Number(soi.lineNumber),
        machineId: machineIds.get(String(soi.serviceItemNumber)) ?? null,
        description: String(soi.description),
        faultComment: String(soi.faultComment),
        bcSystemId: String(soi.id),
      });
  }

  // Allocations from BC for mapped resources …
  for (const a of bc.serviceOrderAllocations) {
    const userId = resourceToUser.get(String(a.resourceNumber));
    const order = orderIds.get(String(a.documentNumber));
    if (!userId || !order) continue;
    await db.insert(s.assignment).values({
      orderId: order.id,
      locationId: order.locationId,
      userId,
      plannedStart: new Date(`${String(a.allocationDate)}T${String(a.startingTime)}`),
      plannedEnd: new Date(`${String(a.allocationDate)}T${String(a.finishingTime)}`),
      bcAllocationId: String(a.id),
    });
  }
  // … plus a guaranteed working day today for each Monteur persona (3 orders each).
  const today = now.toISOString().slice(0, 10);
  for (const p of DEV_PERSONAS.filter((x) => x.bcResourceNo)) {
    const locCode = p.locations[0]!.code;
    const open = bc.serviceOrders.filter((o) => o.responsibilityCenter === locCode && o.status === 'Pending');
    const offset = DEV_PERSONAS.indexOf(p) * 3;
    for (let i = 0; i < 3; i++) {
      const o = open[(offset + i) % open.length]!;
      const order = orderIds.get(String(o.number))!;
      await db.insert(s.assignment).values({
        orderId: order.id,
        locationId: order.locationId,
        userId: userIds.get(p.key)!,
        plannedStart: new Date(`${today}T${String(7 + i * 3).padStart(2, '0')}:00:00`),
        plannedEnd: new Date(`${today}T${String(9 + i * 3).padStart(2, '0')}:30:00`),
      });
      await db
        .update(s.serviceOrder)
        .set({ appStatus: 'EINGEPLANT' })
        .where(sql`${s.serviceOrder.id} = ${order.id}`);
    }
  }

  // ---- Material: items, barcodes, stock of our storages, containers (phase 4) ----
  const storages = await db.select().from(s.storageLocation);
  const storageByCode = new Map(storages.map((x) => [x.bcLocationCode, x]));
  const itemIds = new Map<string, string>();
  for (const it of bc.items) {
    const [row] = await db
      .insert(s.item)
      .values({
        bcCompanyId: SEED_COMPANY.id,
        number: String(it.number),
        name: String(it.displayName),
        unit: String(it.baseUnitOfMeasureCode),
        category: String(it.itemCategoryCode),
        gtin: String(it.gtin),
        isConsumable: DEFAULT_CONSUMABLE_CATEGORIES.includes(String(it.itemCategoryCode)),
        bcSystemId: String(it.id),
      })
      .returning();
    itemIds.set(String(it.number), row!.id);
  }
  for (const r of bc.itemReferences)
    await db
      .insert(s.itemBarcode)
      .values({ itemId: itemIds.get(String(r.itemNumber))!, code: String(r.referenceNumber) })
      .onConflictDoNothing();
  for (const a of bc.itemAvailabilities) {
    const st = storageByCode.get(String(a.locationCode));
    if (st)
      await db.insert(s.itemStock).values({
        itemId: itemIds.get(String(a.itemNumber))!,
        storageLocationId: st.id,
        bcInventory: Number(a.inventory),
      });
  }
  for (const l of SEED_LOCATIONS) {
    const locationId = locIds.get(l.code)!;
    const wh = storageByCode.get(l.warehouse)!.id;
    const tank = storageByCode.get(l.tank)!.id;
    await db.insert(s.container).values([
      {
        locationId,
        storageLocationId: wh,
        itemId: itemIds.get('X990.200.000')!,
        kind: 'FASS',
        name: 'Motoröl 15W-40 (Fass 200 l)',
        capacity: 200,
        minStock: 50,
        quickQuantities: [5, 10, 20, 40],
      },
      {
        locationId,
        storageLocationId: wh,
        itemId: itemIds.get('X990.210.000')!,
        kind: 'IBC',
        name: 'Getriebe-/Hydrauliköl Vario (IBC 1.000 l)',
        capacity: 1000,
        minStock: 150,
        quickQuantities: [5, 10, 20, 40],
      },
      {
        locationId,
        storageLocationId: wh,
        itemId: itemIds.get('X990.220.000')!,
        kind: 'FASS',
        name: 'Hydrauliköl HVLP 46 (Fass 200 l)',
        capacity: 200,
        minStock: 40,
        quickQuantities: [5, 10, 20, 40],
      },
      {
        locationId,
        storageLocationId: wh,
        itemId: itemIds.get('ADBLUE')!,
        kind: 'IBC',
        name: 'AdBlue (IBC 1.000 l)',
        capacity: 1000,
        minStock: 100,
        quickQuantities: [10, 20, 40, 80],
      },
      {
        locationId,
        storageLocationId: wh,
        itemId: itemIds.get('X990.300.000')!,
        kind: 'KARTUSCHE',
        name: 'Mehrzweckfett EP2 (Kartusche)',
        minStock: 10,
        quickQuantities: [1, 2, 5, 10],
      },
      {
        locationId,
        storageLocationId: tank,
        itemId: itemIds.get('DIESEL')!,
        kind: 'TANK',
        name: `Tankanlage Diesel ${l.name}`,
        capacity: 10000,
        minStock: 1000,
        hasMeter: true,
        quickQuantities: [20, 50, 100, 200],
      },
    ]);
  }

  await db.insert(s.setting).values([
    { key: 'rounding', value: { gridMinutes: 15, mode: 'commercial', basis: 'daily_sum' } },
    { key: 'forgotClockOutReminder', value: { time: '19:00' } },
    { key: 'productivityTarget', value: { min: 0.8, max: 0.85 } },
    {
      key: 'retention',
      value: { chatPhotosMonthsAfterBilled: 24, timeDataYears: 6, sickNotesMonthsAfterEnd: 12 },
    },
    { key: 'partsCutoff', value: { time: '17:00' } },
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');
  const { db, pool } = createDb(url, 1);
  seedDev(db)
    .then(() => console.log('dev seed applied'))
    .finally(() => pool.end());
}
