import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { pushRequestSchema, ROLES, type PushRequest } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Roles, Scope } from '../../auth/decorators.js';
import { ZodBody, ZodPipe, ZodQuery } from '../../common/zod.js';
import { SyncService } from './sync.service.js';

const pullQuery = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
});

/** Offline sync for the Monteur device (ARCHITEKTUR 4). */
@ApiTags('Synchronisation')
@ApiBearerAuth()
@Roles(ROLES.Monteur)
@Controller('v1/sync')
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  /** Applies offline commands idempotently in device order. */
  @Post('push')
  @HttpCode(200)
  @ZodBody(pushRequestSchema)
  push(@Scope() scope: AccessScope, @Body(new ZodPipe(pushRequestSchema)) body: PushRequest) {
    return this.sync.push(scope, body);
  }

  /** Returns everything changed since `cursor` within the caller's scope (full snapshot without cursor). */
  @Get('pull')
  @ZodQuery(pullQuery)
  pull(@Scope() scope: AccessScope, @Query(new ZodPipe(pullQuery)) q: z.infer<typeof pullQuery>) {
    return this.sync.pull(scope, q.cursor ?? null);
  }
}
