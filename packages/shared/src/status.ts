import type { BcServiceStatus } from './bc-status.js';

/** Fine-grained app status of a service order (ARCHITEKTUR.md 3.3). */
export const APP_STATUSES = [
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
] as const;

export type AppStatus = (typeof APP_STATUSES)[number];

export interface StatusDefinition {
  label: string;
  bcStatus: BcServiceStatus | null;
  /** Whether a change to this status is written to BC (default: only on Meister approval, E-14). */
  writeToBc: boolean;
  /** Statuses a Monteur may set manually. */
  monteurMaySet: boolean;
  /** Final statuses; time arriving later is routed to the approval inbox. */
  terminal: boolean;
}

export const DEFAULT_STATUS_DEFINITIONS: Record<AppStatus, StatusDefinition> = {
  NEU: { label: 'Neu', bcStatus: 'Pending', writeToBc: false, monteurMaySet: false, terminal: false },
  EINGEPLANT: {
    label: 'Eingeplant',
    bcStatus: 'Pending',
    writeToBc: false,
    monteurMaySet: false,
    terminal: false,
  },
  UNTERWEGS: {
    label: 'Unterwegs',
    bcStatus: 'In Process',
    writeToBc: false,
    monteurMaySet: true,
    terminal: false,
  },
  IN_ARBEIT: {
    label: 'In Arbeit',
    bcStatus: 'In Process',
    writeToBc: false,
    monteurMaySet: true,
    terminal: false,
  },
  WARTET_TEILE: {
    label: 'Wartet auf Teile',
    bcStatus: 'On Hold',
    writeToBc: false,
    monteurMaySet: true,
    terminal: false,
  },
  WARTET_KUNDE: {
    label: 'Wartet auf Kunde/Freigabe',
    bcStatus: 'On Hold',
    writeToBc: false,
    monteurMaySet: true,
    terminal: false,
  },
  FERTIG_DOKU_OFFEN: {
    label: 'Fertig – Doku offen',
    bcStatus: 'In Process',
    writeToBc: false,
    monteurMaySet: true,
    terminal: false,
  },
  FERTIG: { label: 'Fertig', bcStatus: 'Finished', writeToBc: false, monteurMaySet: true, terminal: false },
  FREIGEGEBEN: {
    label: 'Freigegeben (Meister)',
    bcStatus: 'Finished',
    writeToBc: true,
    monteurMaySet: false,
    terminal: true,
  },
  ABGERECHNET: {
    label: 'Abgerechnet',
    bcStatus: null,
    writeToBc: false,
    monteurMaySet: false,
    terminal: true,
  },
};

/** Initial app status derived from a BC status when an order is first imported. */
export function appStatusFromBc(bc: BcServiceStatus): AppStatus {
  switch (bc) {
    case 'Pending':
      return 'NEU';
    case 'In Process':
      return 'IN_ARBEIT';
    case 'On Hold':
      return 'WARTET_KUNDE';
    case 'Finished':
      return 'FERTIG';
  }
}

export type StatusActor = 'MONTEUR' | 'MEISTER' | 'SYSTEM';

/** Allowed manual transitions. SYSTEM transitions (stamping, BC import) bypass this check. */
export function canTransition(from: AppStatus, to: AppStatus, actor: StatusActor): boolean {
  if (from === to) return false;
  if (actor === 'SYSTEM') return true;
  const defs = DEFAULT_STATUS_DEFINITIONS;
  if (to === 'ABGERECHNET') return false; // only from BC
  if (actor === 'MEISTER') return from !== 'ABGERECHNET';
  // MONTEUR
  if (defs[from].terminal) return false;
  return defs[to].monteurMaySet;
}
