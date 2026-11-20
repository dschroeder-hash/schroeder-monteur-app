/**
 * Target of absences in BC (PROMPT 6.3). The business calls it "Zeiterfassungsposten"; whether that is the
 * standard Employee Absence table or an ISV/industry extension is still open (OFFENE-PUNKTE OP-01). The target is
 * therefore an exchangeable adapter selected by the setting `absence.bcTarget`; default = Employee Absence.
 */
import type { EndpointName } from '@schroeder/bc-contract';
import { DEFAULT_CAUSE_CODES, type AbsenceType, type HalfDay } from '@schroeder/shared';

export interface AbsenceForBc {
  type: AbsenceType;
  fromDate: string;
  toDate: string;
  halfDay: HalfDay;
  /** Working days (half day = 0.5). */
  quantity: number;
}

export interface AbsenceSettings {
  bcTarget: string;
  causeCodes: Record<AbsenceType, string>;
  unitOfMeasureCode: string;
}

export interface AbsenceBcTarget {
  readonly key: string;
  readonly endpoint: EndpointName;
  /** Body without employee number – it is resolved from the user mapping when the transfer runs. */
  createBody(a: AbsenceForBc, s: AbsenceSettings): Record<string, unknown>;
}

/** Standard BC "Mitarbeiterabwesenheit" (table 5207) via the API page of the extension. */
export const EMPLOYEE_ABSENCE_TARGET: AbsenceBcTarget = {
  key: 'EMPLOYEE_ABSENCE',
  endpoint: 'employeeAbsences',
  createBody: (a, s) => ({
    fromDate: a.fromDate,
    toDate: a.toDate,
    causeOfAbsenceCode: s.causeCodes[a.type],
    // Never the Monteur's comment: it could contain health data (DATENSCHUTZ.md).
    description: `${a.type === 'KRANK' ? 'Krank' : 'Urlaub'}${a.halfDay === 'AM' ? ' (vormittags)' : a.halfDay === 'PM' ? ' (nachmittags)' : ''} – Monteur-App`,
    quantity: a.quantity,
    unitOfMeasureCode: s.unitOfMeasureCode,
  }),
};

export const ABSENCE_TARGETS: Record<string, AbsenceBcTarget> = {
  [EMPLOYEE_ABSENCE_TARGET.key]: EMPLOYEE_ABSENCE_TARGET,
};

export const DEFAULT_ABSENCE_SETTINGS: AbsenceSettings = {
  bcTarget: EMPLOYEE_ABSENCE_TARGET.key,
  causeCodes: DEFAULT_CAUSE_CODES,
  unitOfMeasureCode: 'TAG',
};
