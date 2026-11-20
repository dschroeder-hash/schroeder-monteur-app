/**
 * Realistic agricultural-machinery test data for the BC mock.
 * All names, customers and numbers are fictitious test data (no real customer data).
 */
import { EMPTY_GUID, type EndpointName } from '@schroeder/bc-contract';
import { rng, stableId } from './ids.js';

export interface SeedLocation {
  code: string;
  name: string;
  bundesland: string;
  /** Location codes: main warehouse, diesel tank, service vans. */
  warehouse: string;
  tank: string;
  vans: string[];
}

export const SEED_COMPANY = {
  id: stableId('company:SCHROEDER'),
  name: 'SCHROEDER',
  displayName: 'Heinrich Schröder Landmaschinen KG (Test)',
};

export const SEED_LOCATIONS: SeedLocation[] = [
  {
    code: 'WILD',
    name: 'Wildeshausen',
    bundesland: 'NI',
    warehouse: 'WILD',
    tank: 'WILD-TANK',
    vans: ['WILD-SW01', 'WILD-SW02'],
  },
  {
    code: 'CLP',
    name: 'Cloppenburg',
    bundesland: 'NI',
    warehouse: 'CLP',
    tank: 'CLP-TANK',
    vans: ['CLP-SW01'],
  },
  {
    code: 'BRV',
    name: 'Bremervörde',
    bundesland: 'NI',
    warehouse: 'BRV',
    tank: 'BRV-TANK',
    vans: ['BRV-SW01'],
  },
  { code: 'ALZ', name: 'Alzey', bundesland: 'RP', warehouse: 'ALZ', tank: 'ALZ-TANK', vans: ['ALZ-SW01'] },
];

export const ORDER_TYPES: Array<{ code: string; description: string }> = [
  { code: 'KUNDE', description: 'Kundenauftrag' },
  { code: 'KLEING', description: 'Kleingerät Kunde' },
  { code: 'WARTUNG', description: 'Wartung Kunde' },
  { code: 'INTWART', description: 'Wartung intern / Wartungsvertrag' },
  { code: 'GARANTIE', description: 'Garantie Hersteller' },
  { code: 'KULANZ', description: 'Kulanz' },
  { code: 'GEBR', description: 'Gebrauchtmaschinen-Aufbereitung' },
  { code: 'UEBERGABE', description: 'Übergabeinspektion' },
];

const FIRST = [
  'Jan',
  'Lukas',
  'Tobias',
  'Hendrik',
  'Marvin',
  'Sven',
  'Dennis',
  'Kai',
  'Timo',
  'Niklas',
  'Florian',
  'Jannik',
  'Ole',
  'Malte',
  'Björn',
  'Lena',
  'Mats',
  'Fynn',
  'Torben',
  'Jens',
];
const LAST = [
  'Meyer',
  'Schulte',
  'Bruns',
  'Wilke',
  'Lüdeke',
  'Thölke',
  'Hörmann',
  'Wessels',
  'Kläne',
  'Ahlers',
  'Brinkmann',
  'Rohlfs',
  'Gerdes',
  'Stöver',
  'Janssen',
  'Dierks',
  'Kuhlmann',
  'Haverkamp',
  'Böckmann',
  'Osterloh',
];
const VILLAGES = [
  ['27793', 'Wildeshausen'],
  ['27801', 'Dötlingen'],
  ['49681', 'Garrel'],
  ['49661', 'Cloppenburg'],
  ['49692', 'Cappeln'],
  ['27432', 'Bremervörde'],
  ['27446', 'Selsingen'],
  ['55232', 'Alzey'],
  ['55234', 'Framersheim'],
  ['27243', 'Harpstedt'],
];
const FARM_FORMS = ['Landwirtschaft', 'Hof', 'Milchviehbetrieb', 'Ackerbau', 'Lohnunternehmen', 'Agrar GbR'];

export const MACHINE_MODELS: Array<{
  brand: string;
  model: string;
  group: string;
  hours: boolean;
  itemNo: string;
}> = [
  { brand: 'FENDT', model: 'Fendt 724 Vario Gen6', group: 'TRAKTOR', hours: true, itemNo: 'M-FEN-724' },
  { brand: 'FENDT', model: 'Fendt 942 Vario', group: 'TRAKTOR', hours: true, itemNo: 'M-FEN-942' },
  { brand: 'FENDT', model: 'Fendt 314 Vario', group: 'TRAKTOR', hours: true, itemNo: 'M-FEN-314' },
  { brand: 'FENDT', model: 'Fendt IDEAL 9T', group: 'MAEHDRESCHER', hours: true, itemNo: 'M-FEN-IDEAL9' },
  { brand: 'FENDT', model: 'Fendt Katana 650', group: 'HAECKSLER', hours: true, itemNo: 'M-FEN-KAT650' },
  { brand: 'VALTRA', model: 'Valtra T235 Versu', group: 'TRAKTOR', hours: true, itemNo: 'M-VAL-T235' },
  { brand: 'VALTRA', model: 'Valtra N175 Direct', group: 'TRAKTOR', hours: true, itemNo: 'M-VAL-N175' },
  { brand: 'MF', model: 'Massey Ferguson 8S.265', group: 'TRAKTOR', hours: true, itemNo: 'M-MF-8S265' },
  { brand: 'MF', model: 'Massey Ferguson 5S.145', group: 'TRAKTOR', hours: true, itemNo: 'M-MF-5S145' },
  {
    brand: 'AMAZONE',
    model: 'Amazone UX 5201 Super',
    group: 'PFLANZENSCHUTZ',
    hours: false,
    itemNo: 'M-AMA-UX5201',
  },
  {
    brand: 'AMAZONE',
    model: 'Amazone ZA-TS 4200',
    group: 'DUENGERSTREUER',
    hours: false,
    itemNo: 'M-AMA-ZATS',
  },
  {
    brand: 'LEMKEN',
    model: 'Lemken Juwel 8 M V',
    group: 'BODENBEARBEITUNG',
    hours: false,
    itemNo: 'M-LEM-JUW8',
  },
  { brand: 'HORSCH', model: 'Horsch Pronto 6 DC', group: 'SAEMASCHINE', hours: false, itemNo: 'M-HOR-PRO6' },
  { brand: 'MERLO', model: 'Merlo TF42.7 CS-145', group: 'TELESKOPLADER', hours: true, itemNo: 'M-MER-TF42' },
  { brand: 'CAT', model: 'CAT 906 Radlader', group: 'RADLADER', hours: true, itemNo: 'M-CAT-906' },
];

const FAULTS = [
  'Wartung 1.000 h nach Herstellerplan',
  'Hydraulik verliert Öl am Heckkraftheber',
  'Fehlermeldung AdBlue-System, Leistungsreduzierung',
  'Klimaanlage kühlt nicht',
  'Getriebe schaltet ruckartig, Fehlercode im Terminal',
  'Spritzgestänge klappt links nicht aus',
  'Reifenwechsel Hinterachse',
  'Druckluftbremse Anhänger ohne Funktion',
  'Übergabeinspektion Neumaschine',
  'Motor springt schlecht an, Kraftstofffilter prüfen',
  'Zapfwelle kuppelt nicht ein',
  'Jahreswartung vor der Saison',
];

/** Items: parts with EAN plus consumables (litres). */
export const ITEMS: Array<{
  no: string;
  name: string;
  uom: string;
  gtin: string;
  category: string;
  price?: number;
}> = [
  { no: 'X990.200.000', name: 'Motoröl AGCO Parts 15W-40', uom: 'L', gtin: '4012345000011', category: 'OEL' },
  {
    no: 'X990.210.000',
    name: 'Getriebe-/Hydrauliköl AGCO Parts Vario',
    uom: 'L',
    gtin: '4012345000028',
    category: 'OEL',
  },
  { no: 'X990.220.000', name: 'Hydrauliköl HVLP 46', uom: 'L', gtin: '4012345000035', category: 'OEL' },
  {
    no: 'X990.300.000',
    name: 'Mehrzweckfett EP2 (Kartusche 400 g)',
    uom: 'STK',
    gtin: '4012345000042',
    category: 'FETT',
  },
  { no: 'X990.310.000', name: 'Fett Lithium EP2 lose', uom: 'KG', gtin: '4012345000059', category: 'FETT' },
  { no: 'DIESEL', name: 'Dieselkraftstoff', uom: 'L', gtin: '', category: 'KRAFTSTOFF' },
  { no: 'ADBLUE', name: 'AdBlue (AUS 32)', uom: 'L', gtin: '4012345000066', category: 'KRAFTSTOFF' },
  {
    no: 'F931.200.020.010',
    name: 'Motorölfilter Fendt Vario',
    uom: 'STK',
    gtin: '4012345100018',
    category: 'FILTER',
  },
  {
    no: 'F931.200.020.110',
    name: 'Kraftstofffilter Fendt Vario',
    uom: 'STK',
    gtin: '4012345100025',
    category: 'FILTER',
  },
  {
    no: 'H931.202.050.010',
    name: 'Luftfilter Hauptelement Fendt 700',
    uom: 'STK',
    gtin: '4012345100032',
    category: 'FILTER',
  },
  {
    no: 'H931.202.050.020',
    name: 'Luftfilter Sicherheitselement Fendt 700',
    uom: 'STK',
    gtin: '4012345100049',
    category: 'FILTER',
  },
  {
    no: 'G716.100.030.010',
    name: 'Hydraulikfilter Fendt Vario',
    uom: 'STK',
    gtin: '4012345100056',
    category: 'FILTER',
  },
  {
    no: 'ACP0360620',
    name: 'Kabinenluftfilter MF 8S',
    uom: 'STK',
    gtin: '4012345100063',
    category: 'FILTER',
  },
  {
    no: 'V836862345',
    name: 'Ölfilter Valtra T-Serie',
    uom: 'STK',
    gtin: '4012345100070',
    category: 'FILTER',
  },
  {
    no: 'V836864780',
    name: 'Kraftstoffvorfilter Valtra',
    uom: 'STK',
    gtin: '4012345100087',
    category: 'FILTER',
  },
  {
    no: 'X548.880.400',
    name: 'Keilrippenriemen Lichtmaschine',
    uom: 'STK',
    gtin: '4012345100094',
    category: 'VERSCHLEISS',
  },
  {
    no: 'X618.240.200',
    name: 'O-Ring-Sortiment Hydraulik',
    uom: 'STK',
    gtin: '4012345100100',
    category: 'VERSCHLEISS',
  },
  {
    no: 'F824.500.010.020',
    name: 'Dichtsatz Hubzylinder',
    uom: 'STK',
    gtin: '4012345100117',
    category: 'HYDRAULIK',
  },
  {
    no: 'F718.870.020.050',
    name: 'Hydraulikschlauch DN12 1.200 mm',
    uom: 'STK',
    gtin: '4012345100124',
    category: 'HYDRAULIK',
  },
  {
    no: 'F339.202.120.010',
    name: 'AdBlue-Pumpenmodul Filter',
    uom: 'STK',
    gtin: '4012345100131',
    category: 'FILTER',
  },
  {
    no: '927301',
    name: 'Düse Lechler IDKT 120-03 (Amazone)',
    uom: 'STK',
    gtin: '4012345200015',
    category: 'VERSCHLEISS',
  },
  { no: '3374022', name: 'Schar Lemken Juwel', uom: 'STK', gtin: '4012345200022', category: 'VERSCHLEISS' },
  { no: '3374140', name: 'Anlage Lemken Juwel', uom: 'STK', gtin: '4012345200039', category: 'VERSCHLEISS' },
  {
    no: '00310425',
    name: 'Säschar Horsch Pronto',
    uom: 'STK',
    gtin: '4012345200046',
    category: 'VERSCHLEISS',
  },
  {
    no: '045361',
    name: 'Kettenrad Merlo Teleskop',
    uom: 'STK',
    gtin: '4012345200053',
    category: 'VERSCHLEISS',
  },
  { no: '1R-0751', name: 'Kraftstofffilter CAT', uom: 'STK', gtin: '4012345200060', category: 'FILTER' },
  { no: 'KAELTE-R134A', name: 'Kältemittel R134a', uom: 'KG', gtin: '4012345300012', category: 'KLIMA' },
  { no: 'BREMSFL-DOT4', name: 'Bremsflüssigkeit DOT 4', uom: 'L', gtin: '4012345300029', category: 'OEL' },
  { no: 'KUEHLM-G12', name: 'Kühlerschutzmittel G12', uom: 'L', gtin: '4012345300036', category: 'OEL' },
  {
    no: 'SCHEIBENREINIGER',
    name: 'Scheibenreiniger Sommer',
    uom: 'L',
    gtin: '4012345300043',
    category: 'OEL',
  },
];

export type Row = Record<string, unknown>;
export type Tables = Record<EndpointName, Row[]> & { companies: Row[] };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the full in-memory dataset.
 * @param now reference time; orders are spread around this date so the app always has current work.
 */
export function buildSeed(now = new Date()): Tables {
  const r = rng(4711);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const ts = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const day = (offset: number) => isoDate(new Date(now.getTime() + offset * 86_400_000));

  const t: Tables = {
    companies: [SEED_COMPANY],
    items: [],
    locations: [],
    customers: [],
    employees: [],
    serviceOrders: [],
    serviceOrderItems: [],
    serviceItems: [],
    resources: [],
    serviceOrderTypes: [],
    responsibilityCenters: [],
    causesOfAbsence: [],
    workTypes: [],
    itemAvailabilities: [],
    itemReferences: [],
    serviceOrderAllocations: [],
    serviceLines: [],
    serviceCommentLines: [],
    serviceOrderAttachments: [],
    customerComments: [],
    itemSubstitutions: [],
    serviceItemComments: [],
    customerContacts: [],
    employeeAbsences: [],
    resourceJournalLines: [],
    itemJournalLines: [],
    postedServiceInvoices: [],
    deletedRecords: [],
  };

  for (const ot of ORDER_TYPES)
    t.serviceOrderTypes.push({ id: stableId(`sot:${ot.code}`), lastModifiedDateTime: ts, ...ot });

  for (const c of [
    { code: 'KRANK', description: 'Krankheit' },
    { code: 'URLAUB', description: 'Urlaub' },
    { code: 'SCHULUNG', description: 'Schulung' },
  ])
    t.causesOfAbsence.push({ id: stableId(`coa:${c.code}`), lastModifiedDateTime: ts, ...c });

  for (const w of [
    { code: 'ARBEIT', description: 'Arbeitszeit' },
    { code: 'FAHRT', description: 'Fahrzeit' },
    { code: 'DIAGNOSE', description: 'Diagnose' },
  ])
    t.workTypes.push({ id: stableId(`wt:${w.code}`), lastModifiedDateTime: ts, ...w });

  const allLocationCodes: string[] = [];
  for (const l of SEED_LOCATIONS) {
    t.responsibilityCenters.push({
      id: stableId(`rc:${l.code}`),
      lastModifiedDateTime: ts,
      code: l.code,
      name: `Schröder ${l.name}`,
      locationCode: l.warehouse,
    });
    for (const [code, name] of [
      [l.warehouse, `Lager ${l.name}`],
      [l.tank, `Tankanlage ${l.name}`],
      ...l.vans.map((v, i) => [v, `Servicewagen ${i + 1} ${l.name}`]),
    ] as Array<[string, string]>) {
      allLocationCodes.push(code);
      t.locations.push({ id: stableId(`loc:${code}`), lastModifiedDateTime: ts, code, displayName: name });
    }
  }

  for (const it of ITEMS) {
    const id = stableId(`item:${it.no}`);
    let total = 0;
    for (const l of SEED_LOCATIONS) {
      const codes = it.no === 'DIESEL' ? [l.tank] : [l.warehouse, ...l.vans];
      for (const code of codes) {
        const isVan = code.includes('-SW');
        let qty: number;
        if (it.no === 'DIESEL') qty = 2000 + Math.round(r() * 6000);
        else if (it.uom === 'L') qty = isVan ? Math.round(r() * 40) : 100 + Math.round(r() * 900);
        else qty = isVan ? Math.round(r() * 4) : Math.round(r() * 25);
        // Some parts are missing at some locations to exercise the overnight transfer flow.
        if (!isVan && it.category === 'HYDRAULIK' && l.code !== 'WILD') qty = 0;
        total += qty;
        t.itemAvailabilities.push({
          itemId: id,
          itemNumber: it.no,
          locationCode: code,
          inventory: qty,
          lastModifiedDateTime: ts,
        });
      }
    }
    t.items.push({
      id,
      lastModifiedDateTime: ts,
      number: it.no,
      displayName: it.name,
      type: 'Inventory',
      itemCategoryCode: it.category,
      baseUnitOfMeasureCode: it.uom,
      gtin: it.gtin,
      inventory: total,
      blocked: false,
    });
    if (it.gtin)
      t.itemReferences.push({
        id: stableId(`iref:${it.no}`),
        lastModifiedDateTime: ts,
        itemNumber: it.no,
        referenceType: 'Bar Code',
        referenceNumber: it.gtin,
        unitOfMeasure: it.uom,
      });
  }

  // Resources / employees per location
  let resNo = 1;
  const resourcesByLoc = new Map<string, string[]>();
  for (const l of SEED_LOCATIONS) {
    const n = l.code === 'WILD' ? 8 : 5;
    const list: string[] = [];
    for (let i = 0; i < n; i++) {
      const given = FIRST[(resNo * 7) % FIRST.length]!;
      const sur = LAST[(resNo * 11) % LAST.length]!;
      const no = `R${String(resNo).padStart(4, '0')}`;
      const empNo = `M${String(resNo).padStart(4, '0')}`;
      t.resources.push({
        id: stableId(`res:${no}`),
        lastModifiedDateTime: ts,
        number: no,
        name: `${given} ${sur}`,
        type: 'Person',
        resourceGroupNumber: `MONT-${l.code}`,
        baseUnitOfMeasureCode: 'STUNDE',
        blocked: false,
      });
      t.employees.push({
        id: stableId(`emp:${empNo}`),
        lastModifiedDateTime: ts,
        number: empNo,
        displayName: `${given} ${sur}`,
        givenName: given,
        surname: sur,
        status: 'Active',
      });
      list.push(no);
      resNo++;
    }
    resourcesByLoc.set(l.code, list);
  }

  // Customers + machines
  const customers: Array<{
    no: string;
    name: string;
    city: string;
    post: string;
    street: string;
    phone: string;
    loc: SeedLocation;
  }> = [];
  for (let i = 1; i <= 40; i++) {
    const loc = SEED_LOCATIONS[i % SEED_LOCATIONS.length]!;
    const [post, city] = pick(VILLAGES) as [string, string];
    const no = `D${String(10000 + i)}`;
    const name = `${pick(FARM_FORMS)} ${pick(LAST)}`;
    const street = `${pick(['Am Esch', 'Hauptstraße', 'Dorfstraße', 'Zum Moor', 'Bauerschaft', 'Feldweg'])} ${1 + Math.floor(r() * 80)}`;
    const phone = `+49 4431 ${100000 + Math.floor(r() * 899999)}`;
    customers.push({ no, name, city, post, street, phone, loc });
    t.customers.push({
      id: stableId(`cust:${no}`),
      lastModifiedDateTime: ts,
      number: no,
      displayName: name,
      addressLine1: street,
      addressLine2: '',
      city,
      postalCode: post,
      country: 'DE',
      phoneNumber: phone,
      email: '',
    });
  }

  const machines: Array<{
    no: string;
    m: (typeof MACHINE_MODELS)[number];
    serial: string;
    customer: string;
  }> = [];
  let siNo = 1;
  for (const c of customers) {
    const count = 1 + Math.floor(r() * 3);
    for (let k = 0; k < count; k++) {
      const m = pick(MACHINE_MODELS);
      const no = `SI${String(siNo++).padStart(5, '0')}`;
      const serial = `${m.brand.slice(0, 3)}${String(Math.floor(r() * 1e8)).padStart(8, '0')}`;
      machines.push({ no, m, serial, customer: c.no });
      t.serviceItems.push({
        id: stableId(`si:${no}`),
        lastModifiedDateTime: ts,
        number: no,
        description: m.model,
        itemNumber: m.itemNo,
        serialNumber: serial,
        customerNumber: c.no,
        serviceItemGroupCode: m.group,
        manufacturerCode: m.brand,
        operatingHours: m.hours ? Math.round(200 + r() * 7800) : null,
      });
    }
  }

  // Substitute items: the old filter is replaced by the new one (successor), two hydraulic filters are
  // interchangeable.
  t.itemSubstitutions.push(
    {
      id: stableId('sub:F931.200.020.110'),
      lastModifiedDateTime: ts,
      itemNumber: 'F931.200.020.110',
      substituteNumber: 'F931.200.020.010',
      interchangeable: false,
      description: 'Nachfolger ab Modelljahr 2024',
    },
    {
      id: stableId('sub:H931.202.050.010'),
      lastModifiedDateTime: ts,
      itemNumber: 'H931.202.050.010',
      substituteNumber: 'H931.202.050.020',
      interchangeable: true,
      description: 'gleichwertig',
    },
  );

  // Remarks and contact persons (deterministic, without the random generator so the orders below stay unchanged).
  const CONTACT_FIRST = ['Hinrich', 'Anke', 'Jens', 'Maren', 'Gerd', 'Silke'];
  customers.forEach((c, i) => {
    const lastName = c.name.split(' ').at(-1) ?? 'Kunde';
    for (let k = 0; k < 1 + (i % 2); k++)
      t.customerContacts.push({
        id: stableId(`kt:${c.no}:${k}`),
        lastModifiedDateTime: ts,
        number: `KT${c.no.slice(1)}${k}`,
        customerNumber: c.no,
        name: `${CONTACT_FIRST[(i + k) % CONTACT_FIRST.length]} ${lastName}`,
        jobTitle: k === 0 ? 'Inhaber' : 'Betriebsleiter',
        phoneNumber: c.phone,
        mobilePhoneNumber: `+49 171 ${String(4000000 + i * 37 + k).padStart(7, '0')}`,
        email: k === 0 ? `info@${lastName.toLowerCase().replace(/[^a-z]/g, '')}-hof.example` : '',
      });
    if (i % 3 === 0)
      t.customerComments.push({
        id: stableId(`cc:${c.no}`),
        lastModifiedDateTime: ts,
        customerNumber: c.no,
        lineNumber: 10000,
        date: '2026-03-02',
        comment: i % 2 ? 'Hofhund – vor Betreten anrufen.' : 'Zahlt nur gegen Rechnung, keine Barzahlung.',
      });
  });
  machines.forEach((m, i) => {
    if (i % 4 === 0)
      t.serviceItemComments.push({
        id: stableId(`sic:${m.no}`),
        lastModifiedDateTime: ts,
        serviceItemNumber: m.no,
        type: 'General',
        lineNumber: 10000,
        date: '2026-05-14',
        comment: 'Frontlader nachgerüstet, Hydraulikanschlüsse vorne links.',
      });
  });

  // Service orders around "now"
  let soNo = 1;
  for (let i = 0; i < 72; i++) {
    const c = customers[i % customers.length]!;
    const cm = machines.filter((x) => x.customer === c.no);
    const mac = pick(cm);
    const fault = pick(FAULTS);
    let type = pick(ORDER_TYPES).code;
    if (fault.startsWith('Wartung') || fault.startsWith('Jahreswartung'))
      type = r() < 0.7 ? 'WARTUNG' : 'KUNDE';
    if (fault.startsWith('Übergabe')) type = 'UEBERGABE';
    const no = `SA-${String(soNo++).padStart(6, '0')}`;
    const offset = Math.floor(r() * 12) - 3;
    const status = offset < -1 ? pick(['In Process', 'Finished', 'On Hold'] as const) : 'Pending';
    const description = type === 'KUNDE' && fault.includes('Wartung') ? `Wartung ${mac.m.model}` : fault;
    t.serviceOrders.push({
      id: stableId(`so:${no}`),
      lastModifiedDateTime: ts,
      number: no,
      description,
      orderType: type,
      status,
      priority: pick(['Low', 'Medium', 'Medium', 'High'] as const),
      orderDate: day(offset - 5),
      responseDate: day(offset),
      customerNumber: c.no,
      customerName: c.name,
      address: c.street,
      address2: '',
      postCode: c.post,
      city: c.city,
      countryCode: 'DE',
      contactName: `${pick(FIRST)} ${c.name.split(' ').pop()}`,
      phoneNumber: c.phone,
      mobilePhoneNumber: `+49 171 ${1000000 + Math.floor(r() * 8999999)}`,
      responsibilityCenter: c.loc.code,
      locationCode: c.loc.warehouse,
      workDescription: '',
    });
    t.serviceOrderItems.push({
      id: stableId(`soi:${no}:10000`),
      lastModifiedDateTime: ts,
      documentNumber: no,
      lineNumber: 10000,
      serviceItemNumber: mac.no,
      itemNumber: mac.m.itemNo,
      serialNumber: mac.serial,
      description: mac.m.model,
      faultComment: fault,
      repairStatusCode: 'INITIAL',
    });
    // Pre-existing allocations for roughly half of the open orders
    if (status === 'Pending' && r() < 0.5) {
      const res = pick(resourcesByLoc.get(c.loc.code)!);
      const startH = 7 + Math.floor(r() * 6);
      t.serviceOrderAllocations.push({
        id: stableId(`alloc:${no}`),
        lastModifiedDateTime: ts,
        documentNumber: no,
        serviceItemLineNumber: 10000,
        resourceNumber: res,
        allocationDate: day(Math.max(0, offset)),
        startingTime: `${String(startH).padStart(2, '0')}:00:00`,
        finishingTime: `${String(startH + 3).padStart(2, '0')}:00:00`,
        allocatedHours: 3,
        status: 'Active',
        monteurAppId: EMPTY_GUID,
      });
    }
  }

  return t;
}

/** Location metadata for the API seed (app-side master data). */
export function seedLocationIndex() {
  return SEED_LOCATIONS.map((l) => ({ ...l, companyId: SEED_COMPANY.id }));
}
