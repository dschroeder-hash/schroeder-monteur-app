/** Entra ID app role values. Keep in sync with the app registration manifest (infra/entra/app-roles.json). */
export const ROLES = {
  Monteur: 'Werkstatt.Monteur',
  Meister: 'Werkstatt.Meister',
  Lager: 'Werkstatt.Lager',
  Personal: 'Werkstatt.Personal',
  Admin: 'Werkstatt.Admin',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
export const ALL_ROLES: readonly Role[] = Object.values(ROLES);

export function isRole(value: string): value is Role {
  return (ALL_ROLES as readonly string[]).includes(value);
}

/** Roles that are bound to a location (scope comes from user_location). */
export const LOCATION_SCOPED_ROLES: readonly Role[] = [ROLES.Monteur, ROLES.Meister, ROLES.Lager];

/** German UI labels. */
export const ROLE_LABELS: Record<Role, string> = {
  'Werkstatt.Monteur': 'Monteur',
  'Werkstatt.Meister': 'Meister',
  'Werkstatt.Lager': 'Lager',
  'Werkstatt.Personal': 'Personal',
  'Werkstatt.Admin': 'Admin',
};
