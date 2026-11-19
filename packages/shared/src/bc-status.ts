/** Mirror of the BC Service Header status (kept here to avoid a runtime dependency on bc-contract). */
export type BcServiceStatus = 'Pending' | 'In Process' | 'Finished' | 'On Hold';
export const BC_STATUS_LABELS: Record<BcServiceStatus, string> = {
  Pending: 'Offen',
  'In Process': 'In Bearbeitung',
  Finished: 'Erledigt',
  'On Hold': 'Zurückgestellt',
};
