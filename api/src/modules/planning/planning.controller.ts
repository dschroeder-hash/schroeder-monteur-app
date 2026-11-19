import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ROLES } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { RequireFeature, Roles, Scope } from '../../auth/decorators.js';
import { uuidParam, ZodBody, ZodPipe, ZodQuery } from '../../common/zod.js';
import { PlanningService } from './planning.service.js';

const dt = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
const boardQuery = z.object({ locationId: z.string().uuid(), from: dt, to: dt });
const createBody = z.object({
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  plannedStart: dt,
  plannedEnd: dt,
});
const moveBody = z.object({ userId: z.string().uuid().optional(), plannedStart: dt, plannedEnd: dt });

/** Planning board for the Meister (PROMPT 5.2). */
@ApiTags('Plantafel')
@ApiBearerAuth()
@Roles(ROLES.Meister)
@RequireFeature('planning.board')
@Controller('v1/planning')
export class PlanningController {
  constructor(@Inject(PlanningService) private readonly planning: PlanningService) {}

  @Get('board')
  @ZodQuery(boardQuery)
  board(@Scope() s: AccessScope, @Query(new ZodPipe(boardQuery)) q: z.infer<typeof boardQuery>) {
    return this.planning.board(s, q.locationId, q.from, q.to);
  }

  @Post('assignments')
  @ZodBody(createBody)
  create(@Scope() s: AccessScope, @Body(new ZodPipe(createBody)) b: z.infer<typeof createBody>) {
    return this.planning.create(s, b);
  }

  @Patch('assignments/:id')
  @ZodBody(moveBody)
  move(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(moveBody)) b: z.infer<typeof moveBody>,
  ) {
    return this.planning.move(s, id, b);
  }

  @Delete('assignments/:id')
  cancel(@Scope() s: AccessScope, @Param('id', new ZodPipe(uuidParam)) id: string) {
    return this.planning.cancel(s, id);
  }
}
