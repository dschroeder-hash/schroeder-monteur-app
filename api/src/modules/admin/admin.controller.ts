import { Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { FEATURES, ROLES } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Roles, Scope } from '../../auth/decorators.js';
import { AuditService } from '../../common/audit.service.js';
import { uuidParam, ZodBody, ZodPipe } from '../../common/zod.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db } from '../../db/client.js';
import {
  appUser,
  bcResourceMapping,
  checklistTemplate,
  featureFlag,
  location,
  userLocation,
} from '../../db/schema.js';
import { FeatureService } from '../../features/feature.service.js';

/**
 * Service checklist template (E-67) – layout of the checklist in Business Central, entered or imported as JSON
 * by the Admin. Item ids must be unique and stable (answers are stored per id).
 */
const checklistBody = z.object({
  title: z.string().trim().min(2).max(120),
  locationId: z.string().uuid().nullable().default(null),
  orderTypeCode: z.string().trim().max(20).nullable().default(null),
  brand: z.string().trim().max(40).nullable().default(null),
  active: z.boolean().default(true),
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        text: z.string().trim().min(1).max(250),
        kind: z.enum(['heading', 'line']).default('line'),
        checkbox: z.boolean().default(false),
        answer: z.enum(['none', 'text', 'number', 'option']).default('none'),
        options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
        unit: z.string().max(20).nullish(),
        unitOptions: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
        required: z.boolean().default(false),
        orderTypes: z.array(z.string().trim().min(1).max(20)).max(20).nullish(),
      }),
    )
    .min(1)
    .max(300)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, {
      message: 'Die Kennungen (id) der Punkte müssen eindeutig sein',
    }),
});

const locationBody = z.object({
  code: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9-]+$/),
  name: z.string().min(2),
  bundesland: z.enum([
    'BW',
    'BY',
    'BE',
    'BB',
    'HB',
    'HH',
    'HE',
    'MV',
    'NI',
    'NW',
    'RP',
    'SL',
    'SN',
    'ST',
    'SH',
    'TH',
  ]),
  bcCompanyId: z.string().uuid(),
  bcResponsibilityCenter: z.string().min(1),
  defaultLocationCode: z.string().min(1),
  active: z.boolean().default(true),
});

const grantsBody = z.object({
  grants: z.array(
    z.object({
      locationId: z.string().uuid(),
      role: z.enum(['MONTEUR', 'MEISTER', 'LAGER']),
      serviceVanStorageId: z.string().uuid().nullable().optional(),
    }),
  ),
  isApprentice: z.boolean().optional(),
  active: z.boolean().optional(),
});

const mappingBody = z.object({
  bcCompanyId: z.string().uuid(),
  bcResourceNo: z.string().min(1),
  bcEmployeeNo: z.string().nullable().optional(),
});

const featureBody = z.object({
  locationId: z.string().uuid().nullable(),
  feature: z.enum(FEATURES),
  enabled: z.boolean(),
  /** e.g. reference to the works council agreement */
  note: z.string().max(500).optional(),
});

/** App master data (Admin only). Every change is written to the audit log. */
@ApiTags('Administration')
@ApiBearerAuth()
@Roles(ROLES.Admin)
@Controller('v1/admin')
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FeatureService) private readonly features: FeatureService,
  ) {}

  @Get('locations')
  locations() {
    return this.db.select().from(location).orderBy(asc(location.code));
  }

  @Post('locations')
  @ZodBody(locationBody)
  async createLocation(
    @Scope() s: AccessScope,
    @Body(new ZodPipe(locationBody)) body: z.infer<typeof locationBody>,
  ) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [row] = await tx.insert(location).values(body).returning();
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'CREATE',
        entity: 'location',
        entityId: row!.id,
        newValue: row,
      });
      return row;
    });
  }

  @Patch('locations/:id')
  @ZodBody(locationBody.partial())
  async updateLocation(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(locationBody.partial())) body: Partial<z.infer<typeof locationBody>>,
  ) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [old] = await tx.select().from(location).where(eq(location.id, id));
      if (!old) throw new NotFoundException('Standort nicht gefunden');
      const [row] = await tx.update(location).set(body).where(eq(location.id, id)).returning();
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'UPDATE',
        entity: 'location',
        entityId: id,
        oldValue: old,
        newValue: row,
      });
      return row;
    });
  }

  @Get('users')
  async users() {
    const users = await this.db.select().from(appUser).orderBy(asc(appUser.displayName));
    const grants = await this.db.select().from(userLocation);
    const maps = await this.db.select().from(bcResourceMapping);
    return users.map((u) => ({
      ...u,
      grants: grants.filter((g) => g.userId === u.id),
      bcMapping: maps.find((m) => m.userId === u.id) ?? null,
    }));
  }

  @Put('users/:id/grants')
  @ZodBody(grantsBody)
  async setGrants(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(grantsBody)) body: z.infer<typeof grantsBody>,
  ) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [user] = await tx.select().from(appUser).where(eq(appUser.id, id));
      if (!user) throw new NotFoundException('Benutzer nicht gefunden');
      const old = await tx.select().from(userLocation).where(eq(userLocation.userId, id));
      await tx.delete(userLocation).where(eq(userLocation.userId, id));
      if (body.grants.length)
        await tx.insert(userLocation).values(
          body.grants.map((g) => ({
            ...g,
            serviceVanStorageId: g.serviceVanStorageId ?? null,
            userId: id,
          })),
        );
      if (body.isApprentice !== undefined || body.active !== undefined)
        await tx
          .update(appUser)
          .set({ isApprentice: body.isApprentice ?? user.isApprentice, active: body.active ?? user.active })
          .where(eq(appUser.id, id));
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'SET_GRANTS',
        entity: 'app_user',
        entityId: id,
        oldValue: { grants: old, isApprentice: user.isApprentice, active: user.active },
        newValue: body,
      });
      return { ok: true };
    });
  }

  @Put('users/:id/bc-mapping')
  @ZodBody(mappingBody)
  async setMapping(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(mappingBody)) body: z.infer<typeof mappingBody>,
  ) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [old] = await tx.select().from(bcResourceMapping).where(eq(bcResourceMapping.userId, id));
      const values = {
        userId: id,
        bcCompanyId: body.bcCompanyId,
        bcResourceNo: body.bcResourceNo,
        bcEmployeeNo: body.bcEmployeeNo ?? null,
      };
      await tx
        .insert(bcResourceMapping)
        .values(values)
        .onConflictDoUpdate({ target: bcResourceMapping.userId, set: values });
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'SET_BC_MAPPING',
        entity: 'app_user',
        entityId: id,
        oldValue: old ?? null,
        newValue: values,
      });
      return values;
    });
  }

  @Get('features')
  featureFlags() {
    return this.db.select().from(featureFlag);
  }

  @Put('features')
  @ZodBody(featureBody)
  async setFeature(
    @Scope() s: AccessScope,
    @Body(new ZodPipe(featureBody)) body: z.infer<typeof featureBody>,
  ) {
    const result = await withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const where = and(
        body.locationId ? eq(featureFlag.locationId, body.locationId) : isNull(featureFlag.locationId),
        eq(featureFlag.feature, body.feature),
      );
      const [old] = await tx.select().from(featureFlag).where(where);
      if (old)
        await tx
          .update(featureFlag)
          .set({ enabled: body.enabled, note: body.note ?? null, changedBy: s.userId })
          .where(where);
      else await tx.insert(featureFlag).values({ ...body, note: body.note ?? null, changedBy: s.userId });
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'SET_FEATURE',
        entity: 'feature_flag',
        entityId: `${body.locationId ?? '*'}:${body.feature}`,
        oldValue: old ?? null,
        newValue: body,
        reason: body.note,
      });
      return body;
    });
    this.features.invalidate();
    return result;
  }

  @Get('checklist-templates')
  checklistTemplates() {
    return this.db.select().from(checklistTemplate).orderBy(asc(checklistTemplate.title));
  }

  @Post('checklist-templates')
  @ZodBody(checklistBody)
  async createChecklistTemplate(
    @Scope() s: AccessScope,
    @Body(new ZodPipe(checklistBody)) body: z.infer<typeof checklistBody>,
  ) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [row] = await tx.insert(checklistTemplate).values(body).returning();
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'CREATE',
        entity: 'checklist_template',
        entityId: row!.id,
        newValue: { title: row!.title, items: row!.items.length },
      });
      return row;
    });
  }

  @Put('checklist-templates/:id')
  @ZodBody(checklistBody)
  async updateChecklistTemplate(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(checklistBody)) body: z.infer<typeof checklistBody>,
  ) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [old] = await tx.select().from(checklistTemplate).where(eq(checklistTemplate.id, id));
      if (!old) throw new NotFoundException('Vorlage nicht gefunden');
      const [row] = await tx
        .update(checklistTemplate)
        .set(body)
        .where(eq(checklistTemplate.id, id))
        .returning();
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'UPDATE',
        entity: 'checklist_template',
        entityId: id,
        oldValue: { title: old.title, active: old.active, items: old.items.length },
        newValue: { title: row!.title, active: row!.active, items: row!.items.length },
      });
      return row;
    });
  }
}
