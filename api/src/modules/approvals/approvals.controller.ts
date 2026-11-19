import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ACTIVITIES, APP_STATUSES, ROLES, STAMP_KINDS } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Roles, Scope } from '../../auth/decorators.js';
import { uuidParam, ZodBody, ZodPipe, ZodQuery } from '../../common/zod.js';
import { ApprovalsService } from './approvals.service.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const inboxQuery = z.object({ locationId: z.string().uuid() });
const dayBody = z.object({ userId: z.string().uuid(), workDate: date });
const correctionEvent = z.object({
  kind: z.enum(STAMP_KINDS),
  time,
  orderId: z.string().uuid().nullish(),
  activity: z.enum(ACTIVITIES).nullish(),
  overheadCode: z.string().max(40).nullish(),
});
const correctBody = z.object({
  userId: z.string().uuid(),
  workDate: date,
  voidEventIds: z.array(z.string().uuid()).max(50).default([]),
  addEvents: z.array(correctionEvent).max(20).default([]),
  reason: z.string().trim().min(5, 'Begründung ist Pflicht').max(500),
});
const decideBody = z.object({
  decision: z.enum(['ANGENOMMEN', 'ABGELEHNT']),
  reason: z.string().max(500).default(''),
});
const statusBody = z.object({ status: z.enum(APP_STATUSES), note: z.string().max(500).optional() });

/** Approval inbox of the Meister (PROMPT 5.3). */
@ApiTags('Freigaben')
@ApiBearerAuth()
@Roles(ROLES.Meister)
@Controller('v1')
export class ApprovalsController {
  constructor(@Inject(ApprovalsService) private readonly approvals: ApprovalsService) {}

  @Get('approvals/inbox')
  @ZodQuery(inboxQuery)
  inbox(@Scope() s: AccessScope, @Query(new ZodPipe(inboxQuery)) q: z.infer<typeof inboxQuery>) {
    return this.approvals.inbox(s, q.locationId);
  }

  @Get('approvals/day-events')
  @ZodQuery(dayBody)
  dayEvents(@Scope() s: AccessScope, @Query(new ZodPipe(dayBody)) q: z.infer<typeof dayBody>) {
    return this.approvals.dayEvents(s, q.userId, q.workDate);
  }

  @Post('approvals/time-days')
  @HttpCode(200)
  @ZodBody(dayBody)
  approveDay(@Scope() s: AccessScope, @Body(new ZodPipe(dayBody)) b: z.infer<typeof dayBody>) {
    return this.approvals.approveDay(s, b.userId, b.workDate);
  }

  @Post('approvals/time-corrections')
  @HttpCode(200)
  @ZodBody(correctBody)
  correct(@Scope() s: AccessScope, @Body(new ZodPipe(correctBody)) b: z.infer<typeof correctBody>) {
    return this.approvals.correct(s, b);
  }

  @Post('approvals/correction-requests/:id')
  @HttpCode(200)
  @ZodBody(decideBody)
  decide(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(decideBody)) b: z.infer<typeof decideBody>,
  ) {
    return this.approvals.decideCorrection(s, id, b.decision, b.reason);
  }

  @Post('orders/:id/status')
  @HttpCode(200)
  @ZodBody(statusBody)
  setStatus(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(statusBody)) b: z.infer<typeof statusBody>,
  ) {
    return this.approvals.setOrderStatus(s, id, b.status, b.note);
  }
}
