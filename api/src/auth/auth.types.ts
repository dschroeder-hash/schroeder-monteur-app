import type { Role } from '@schroeder/shared';

/** Verified token claims. */
export interface Principal {
  oid: string;
  tid?: string;
  name: string;
  email: string;
  roles: Role[];
}

export interface LocationGrant {
  locationId: string;
  role: 'MONTEUR' | 'MEISTER' | 'LAGER' | 'TERMINAL';
}

/**
 * Effective access scope of the current request. Every service method that reads or writes user data
 * takes this as a mandatory parameter (ENTSCHEIDUNGEN E-08).
 */
export interface AccessScope {
  userId: string;
  principal: Principal;
  roles: Role[];
  grants: LocationGrant[];
  /** Locations where the user is Monteur. */
  monteurLocationIds: string[];
  /** Locations where the user is Meister (requires Entra role Meister). */
  meisterLocationIds: string[];
  lagerLocationIds: string[];
  /** Locations whose shared workshop PC this account is (E-72). */
  terminalLocationIds?: string[];
  /** All locations the user is assigned to. */
  locationIds: string[];
}

declare module 'express' {
  interface Request {
    principal?: Principal;
    scope?: AccessScope;
  }
}
