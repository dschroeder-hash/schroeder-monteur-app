import { ROLES, type Role } from '@schroeder/shared';

export interface DevPersona {
  key: string;
  oid: string;
  name: string;
  email: string;
  roles: Role[];
  /** location code → location role */
  locations: Array<{ code: string; role: 'MONTEUR' | 'MEISTER' | 'LAGER' }>;
  bcResourceNo?: string;
  bcEmployeeNo?: string;
  isApprentice?: boolean;
}

/** Fixed test personas (dev/test only). OIDs are fixed so tokens are reproducible. */
export const DEV_PERSONAS: DevPersona[] = [
  {
    key: 'monteur-wild',
    oid: '00000000-0000-4000-8000-000000000101',
    name: 'Jan Meyer (Monteur WILD)',
    email: 'monteur.wild@example.invalid',
    roles: [ROLES.Monteur],
    locations: [{ code: 'WILD', role: 'MONTEUR' }],
    bcResourceNo: 'R0001',
    bcEmployeeNo: 'M0001',
  },
  {
    key: 'monteur2-wild',
    oid: '00000000-0000-4000-8000-000000000102',
    name: 'Lukas Bruns (Monteur WILD)',
    email: 'monteur2.wild@example.invalid',
    roles: [ROLES.Monteur],
    locations: [{ code: 'WILD', role: 'MONTEUR' }],
    bcResourceNo: 'R0002',
    bcEmployeeNo: 'M0002',
  },
  {
    key: 'azubi-wild',
    oid: '00000000-0000-4000-8000-000000000103',
    name: 'Fynn Ahlers (Azubi WILD)',
    email: 'azubi.wild@example.invalid',
    roles: [ROLES.Monteur],
    locations: [{ code: 'WILD', role: 'MONTEUR' }],
    bcResourceNo: 'R0003',
    bcEmployeeNo: 'M0003',
    isApprentice: true,
  },
  {
    key: 'monteur-clp',
    oid: '00000000-0000-4000-8000-000000000201',
    name: 'Hendrik Wessels (Monteur CLP)',
    email: 'monteur.clp@example.invalid',
    roles: [ROLES.Monteur],
    locations: [{ code: 'CLP', role: 'MONTEUR' }],
    bcResourceNo: 'R0009',
    bcEmployeeNo: 'M0009',
  },
  {
    key: 'meister-wild',
    oid: '00000000-0000-4000-8000-000000000111',
    name: 'Björn Gerdes (Meister WILD)',
    email: 'meister.wild@example.invalid',
    roles: [ROLES.Meister],
    locations: [{ code: 'WILD', role: 'MEISTER' }],
  },
  {
    key: 'meister-clp',
    oid: '00000000-0000-4000-8000-000000000211',
    name: 'Torben Janssen (Meister CLP)',
    email: 'meister.clp@example.invalid',
    roles: [ROLES.Meister],
    locations: [{ code: 'CLP', role: 'MEISTER' }],
  },
  {
    key: 'lager-wild',
    oid: '00000000-0000-4000-8000-000000000121',
    name: 'Mats Stöver (Lager WILD)',
    email: 'lager.wild@example.invalid',
    roles: [ROLES.Lager],
    locations: [{ code: 'WILD', role: 'LAGER' }],
  },
  {
    key: 'personal',
    oid: '00000000-0000-4000-8000-000000000901',
    name: 'Lena Dierks (Personal)',
    email: 'personal@example.invalid',
    roles: [ROLES.Personal],
    locations: [],
  },
  {
    key: 'admin',
    oid: '00000000-0000-4000-8000-000000000999',
    name: 'Admin Werkstatt-App',
    email: 'admin@example.invalid',
    roles: [ROLES.Admin],
    locations: [],
  },
];
