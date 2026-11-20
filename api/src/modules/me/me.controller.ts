import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { eq, inArray, or } from 'drizzle-orm';
import type { AccessScope } from '../../auth/auth.types.js';
import { Scope } from '../../auth/decorators.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db } from '../../db/client.js';
import {
  absence,
  appUser,
  approval,
  auditLog,
  bcResourceMapping,
  chatMessage,
  consumption,
  location,
  notification,
  partRequest,
  photo,
  productivitySnapshot,
  pushSubscription,
  stampEvent,
  stampEventVoid,
  timeCorrectionRequest,
  timeEntry,
  userLocation,
  vacationBalance,
  workReport,
} from '../../db/schema.js';
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

  /**
   * Self-service data export (Art. 15/20 DSGVO, OP-39): everything stored about the signed-in user, as JSON file.
   * Every query is filtered by the user's own id (even where the role would allow more, e.g. a Meister's location).
   */
  @Get('export')
  @Header('Content-Type', 'application/json; charset=utf-8')
  async export(@Scope() scope: AccessScope, @Res({ passthrough: true }) res: Response) {
    const me = scope.userId;
    const data = await withSession(this.db, { userId: me, roles: scope.roles }, async (tx) => ({
      exportedAt: new Date().toISOString(),
      note: 'Datenauskunft Schröder Monteur-App (Art. 15 DSGVO). Fotos als Metadaten; die Bilder selbst stellt der Admin auf Anfrage bereit.',
      profile: (await tx.select().from(appUser).where(eq(appUser.id, me)))[0] ?? null,
      locations: await tx.select().from(userLocation).where(eq(userLocation.userId, me)),
      bcMapping: await tx.select().from(bcResourceMapping).where(eq(bcResourceMapping.userId, me)),
      stampEvents: await tx.select().from(stampEvent).where(eq(stampEvent.userId, me)),
      voidedStampEvents: await tx.select().from(stampEventVoid).where(eq(stampEventVoid.userId, me)),
      timeEntries: await tx.select().from(timeEntry).where(eq(timeEntry.userId, me)),
      correctionRequests: await tx
        .select()
        .from(timeCorrectionRequest)
        .where(eq(timeCorrectionRequest.userId, me)),
      absences: await tx.select().from(absence).where(eq(absence.userId, me)),
      vacationBalances: await tx.select().from(vacationBalance).where(eq(vacationBalance.userId, me)),
      consumptions: await tx.select().from(consumption).where(eq(consumption.userId, me)),
      partRequests: await tx.select().from(partRequest).where(eq(partRequest.requestedBy, me)),
      workReports: await tx.select().from(workReport).where(eq(workReport.authorId, me)),
      chatMessages: await tx.select().from(chatMessage).where(eq(chatMessage.authorId, me)),
      photos: (await tx.select().from(photo).where(eq(photo.uploadedBy, me))).map(
        ({ blobPath: _b, ...p }) => p,
      ),
      notifications: await tx.select().from(notification).where(eq(notification.userId, me)),
      pushSubscriptions: (
        await tx.select().from(pushSubscription).where(eq(pushSubscription.userId, me))
      ).map((p) => ({
        userAgent: p.userAgent,
        createdAt: p.createdAt,
      })),
      productivity: await tx.select().from(productivitySnapshot).where(eq(productivitySnapshot.userId, me)),
      approvalsGiven: await tx.select().from(approval).where(eq(approval.approvedBy, me)),
      auditLog: await tx
        .select()
        .from(auditLog)
        .where(or(eq(auditLog.actorId, me), eq(auditLog.entityId, me))),
    }));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="monteur-app-daten-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return data;
  }
}
