import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { eq, inArray } from 'drizzle-orm';
import type { AccessScope } from '../../auth/auth.types.js';
import { Scope } from '../../auth/decorators.js';
import { DB } from '../../db/db.module.js';
import type { Db } from '../../db/client.js';
import { appUser, bcResourceMapping, location } from '../../db/schema.js';
import { FeatureService } from '../../features/feature.service.js';

@ApiTags('Benutzer')
@ApiBearerAuth()
@Controller('v1/me')
export class MeController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FeatureService) private readonly features: FeatureService,
  ) {}

  /** Profile, roles, location grants and effective feature flags of the signed-in user. */
  @Get()
  async me(@Scope() scope: AccessScope) {
    const [user] = await this.db.select().from(appUser).where(eq(appUser.id, scope.userId));
    const locs = scope.locationIds.length
      ? await this.db
          .select({ id: location.id, code: location.code, name: location.name })
          .from(location)
          .where(inArray(location.id, scope.locationIds))
      : [];
    const [mapping] = await this.db
      .select()
      .from(bcResourceMapping)
      .where(eq(bcResourceMapping.userId, scope.userId));
    return {
      id: scope.userId,
      displayName: user?.displayName,
      email: user?.email,
      isApprentice: user?.isApprentice ?? false,
      roles: scope.roles,
      grants: scope.grants.map((g) => ({ ...g, location: locs.find((l) => l.id === g.locationId) })),
      bcResourceNo: mapping?.bcResourceNo ?? null,
      features: await this.features.effective(scope.locationIds),
    };
  }
}
