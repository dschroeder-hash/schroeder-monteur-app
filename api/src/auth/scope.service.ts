import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ROLES } from '@schroeder/shared';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/client.js';
import { appUser, userLocation } from '../db/schema.js';
import type { AccessScope, LocationGrant, Principal } from './auth.types.js';

export class UserInactiveError extends Error {}

@Injectable()
export class ScopeService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Resolves the app user for a verified principal and builds the access scope.
   * Unknown users are provisioned without any location grants (an Admin assigns them later),
   * so they can sign in but see no data.
   */
  async resolve(p: Principal): Promise<AccessScope> {
    let [user] = await this.db.select().from(appUser).where(eq(appUser.entraOid, p.oid)).limit(1);
    if (!user) {
      [user] = await this.db
        .insert(appUser)
        .values({ entraOid: p.oid, displayName: p.name || p.email || p.oid, email: p.email })
        .onConflictDoNothing()
        .returning();
      user ??= (await this.db.select().from(appUser).where(eq(appUser.entraOid, p.oid)).limit(1))[0];
    }
    if (!user || !user.active) throw new UserInactiveError();
    // Remember the Entra roles (needed e.g. to notify Personal about absences).
    const roles = [...p.roles].sort();
    if (roles.join(',') !== [...(user.roles ?? [])].sort().join(','))
      await this.db.update(appUser).set({ roles }).where(eq(appUser.id, user.id));

    const rows = await this.db.select().from(userLocation).where(eq(userLocation.userId, user.id));
    // A location grant only counts if the matching Entra role is present.
    const roleFor: Record<LocationGrant['role'], string> = {
      MONTEUR: ROLES.Monteur,
      MEISTER: ROLES.Meister,
      LAGER: ROLES.Lager,
    };
    const grants = rows
      .filter((r) => p.roles.includes(roleFor[r.role] as (typeof p.roles)[number]))
      .map((r) => ({ locationId: r.locationId, role: r.role }));
    const ids = (role: LocationGrant['role']) => [
      ...new Set(grants.filter((g) => g.role === role).map((g) => g.locationId)),
    ];
    return {
      userId: user.id,
      principal: p,
      roles: p.roles,
      grants,
      monteurLocationIds: ids('MONTEUR'),
      meisterLocationIds: ids('MEISTER'),
      lagerLocationIds: ids('LAGER'),
      locationIds: [...new Set(grants.map((g) => g.locationId))],
    };
  }
}
