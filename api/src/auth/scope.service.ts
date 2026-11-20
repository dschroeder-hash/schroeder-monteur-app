import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { isRole, ROLES } from '@schroeder/shared';
import { DB } from '../db/db.module.js';
import { withSession, type Db } from '../db/client.js';
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
    return this.build(user, p);
  }

  /**
   * Scope of an employee who identified at the workshop PC with personnel number + PIN (E-72): built from the
   * Entra roles seen at the employee's last sign-in and the location grants – never more than on the own device.
   */
  async forUser(userId: string): Promise<AccessScope> {
    const [user] = await this.db.select().from(appUser).where(eq(appUser.id, userId)).limit(1);
    if (!user || !user.active) throw new UserInactiveError();
    // Employees without an own device may never have signed in: identified at the workshop PC as Monteur, the
    // Monteur role counts; location grants stay as maintained by the Admin.
    const roles = [...new Set([...(user.roles ?? []).filter(isRole), ROLES.Monteur])];
    return this.build(user, { oid: user.entraOid, name: user.displayName, email: user.email, roles }, false);
  }

  private async build(
    user: typeof appUser.$inferSelect,
    p: Principal,
    remember = true,
  ): Promise<AccessScope> {
    // Remember the Entra roles (needed e.g. to notify Personal about absences).
    const roles = [...p.roles].sort();
    if (remember && roles.join(',') !== [...(user.roles ?? [])].sort().join(','))
      // as the user itself – RLS allows only the own row (and no status change, migration 0012)
      await withSession(this.db, { userId: user.id, roles }, (tx) =>
        tx.update(appUser).set({ roles }).where(eq(appUser.id, user.id)),
      );

    const rows = await this.db.select().from(userLocation).where(eq(userLocation.userId, user.id));
    // A location grant only counts if the matching Entra role is present.
    const roleFor: Record<LocationGrant['role'], string> = {
      MONTEUR: ROLES.Monteur,
      MEISTER: ROLES.Meister,
      LAGER: ROLES.Lager,
      TERMINAL: ROLES.Terminal,
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
      terminalLocationIds: ids('TERMINAL'),
      locationIds: [...new Set(grants.map((g) => g.locationId))],
    };
  }
}
