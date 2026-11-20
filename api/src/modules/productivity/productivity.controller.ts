import { Body, Controller, Get, HttpCode, Inject, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PRODUCTIVITY_CATEGORIES, ROLES } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Roles, Scope } from '../../auth/decorators.js';
import { ZodBody, ZodPipe, ZodQuery } from '../../common/zod.js';
import { ProductivityService } from './productivity.service.js';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Monat im Format JJJJ-MM');
const meQuery = z.object({ month: month.optional() });
const teamQuery = z.object({ locationId: z.string().uuid(), month: month.optional() });
const mappingBody = z.object({
  orderTypeCode: z.string().trim().min(1).max(20),
  category: z.enum(PRODUCTIVITY_CATEGORIES),
  productive: z.boolean(),
  external: z.boolean(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const configBody = z.object({
  targetMin: z.number().min(0).max(2),
  targetMax: z.number().min(0).max(2),
  legacyMaintenanceRule: z.boolean(),
});

/** Productivity (PROMPT 5.11). Own view for the Monteur, team view for the Meister – both feature-flagged. */
@ApiTags('Produktivität')
@ApiBearerAuth()
@Controller('v1/productivity')
export class ProductivityController {
  constructor(@Inject(ProductivityService) private readonly productivity: ProductivityService) {}

  @Get('me')
  @Roles(ROLES.Monteur)
  @ZodQuery(meQuery)
  mine(@Scope() s: AccessScope, @Query(new ZodPipe(meQuery)) q: z.infer<typeof meQuery>) {
    return this.productivity.mine(s, q.month);
  }

  @Get('team')
  @Roles(ROLES.Meister)
  @ZodQuery(teamQuery)
  team(@Scope() s: AccessScope, @Query(new ZodPipe(teamQuery)) q: z.infer<typeof teamQuery>) {
    return this.productivity.team(s, q.locationId, q.month);
  }
}

/** Mapping of BC order types and target corridor. The Admin sees no individual productivity (ARCHITEKTUR 2). */
@ApiTags('Administration')
@ApiBearerAuth()
@Roles(ROLES.Admin)
@Controller('v1/admin/productivity')
export class ProductivityAdminController {
  constructor(@Inject(ProductivityService) private readonly productivity: ProductivityService) {}

  @Get()
  config() {
    return this.productivity.adminConfig();
  }

  @Post('mapping')
  @ZodBody(mappingBody)
  addMapping(@Scope() s: AccessScope, @Body(new ZodPipe(mappingBody)) b: z.infer<typeof mappingBody>) {
    return this.productivity.addMapping(s, b);
  }

  @Put('config')
  @HttpCode(200)
  @ZodBody(configBody)
  setConfig(@Scope() s: AccessScope, @Body(new ZodPipe(configBody)) b: z.infer<typeof configBody>) {
    return this.productivity.setConfig(s, b);
  }
}
