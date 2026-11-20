import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ROLES } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Roles, Scope } from '../../auth/decorators.js';
import { uuidParam, ZodBody, ZodPipe, ZodQuery } from '../../common/zod.js';
import { AbsenceService } from './absence.service.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');
const rangeQuery = z
  .object({ from: date, to: date, locationId: z.string().uuid().optional() })
  .refine((q) => q.to >= q.from, { message: 'Ende liegt vor dem Beginn' })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 400 * 86_400_000, { message: 'Zeitraum zu lang' });
const sickBody = z
  .object({
    userId: z.string().uuid(),
    fromDate: date,
    toDate: date.nullish(),
    comment: z.string().max(500).nullish(),
  })
  .refine((b) => !b.toDate || b.toDate >= b.fromDate, { message: 'Ende liegt vor dem Beginn' });
const endBody = z.object({ toDate: date });
const decisionBody = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().max(500).default(''),
});
const yearQuery = z.object({ year: z.coerce.number().int().min(2020).max(2100) });
const balanceBody = z.object({
  userId: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  entitlementDays: z.number().min(0).max(60).multipleOf(0.5),
  carryOverDays: z.number().min(0).max(60).multipleOf(0.5).default(0),
});

/** Sick reports and vacation (PROMPT 5.9/5.10). Monteure write via offline commands (sync). */
@ApiTags('Abwesenheiten')
@ApiBearerAuth()
@Controller('v1/absences')
export class AbsenceController {
  constructor(@Inject(AbsenceService) private readonly absences: AbsenceService) {}

  /** Team calendar: who is absent – never why. */
  @Get('team')
  @Roles(ROLES.Monteur, ROLES.Meister)
  @ZodQuery(rangeQuery)
  team(@Scope() s: AccessScope, @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.absences.team(s, q.from, q.to);
  }

  /** Absences with type: Meister (own locations), Personal (all locations). */
  @Get()
  @Roles(ROLES.Meister, ROLES.Personal)
  @ZodQuery(rangeQuery)
  list(@Scope() s: AccessScope, @Query(new ZodPipe(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.absences.list(s, q);
  }

  @Post('sick')
  @Roles(ROLES.Meister, ROLES.Personal)
  @ZodBody(sickBody)
  reportSick(@Scope() s: AccessScope, @Body(new ZodPipe(sickBody)) b: z.infer<typeof sickBody>) {
    return this.absences.reportSickOnBehalf(s, b.userId, b);
  }

  @Post(':id/end')
  @HttpCode(200)
  @Roles(ROLES.Meister, ROLES.Personal)
  @ZodBody(endBody)
  setEnd(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(endBody)) b: z.infer<typeof endBody>,
  ) {
    return this.absences.setSickEnd(s, id, b.toDate);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @Roles(ROLES.Meister)
  acknowledge(@Scope() s: AccessScope, @Param('id', new ZodPipe(uuidParam)) id: string) {
    return this.absences.acknowledgeSick(s, id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Roles(ROLES.Meister)
  @ZodBody(decisionBody)
  decide(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(decisionBody)) b: z.infer<typeof decisionBody>,
  ) {
    return this.absences.decideVacation(s, id, b.decision, b.reason);
  }

  @Get('balances')
  @Roles(ROLES.Meister, ROLES.Personal)
  @ZodQuery(yearQuery)
  balances(@Scope() s: AccessScope, @Query(new ZodPipe(yearQuery)) q: z.infer<typeof yearQuery>) {
    return this.absences.balances(s, q.year);
  }

  @Put('balances')
  @HttpCode(200)
  @Roles(ROLES.Personal)
  @ZodBody(balanceBody)
  setBalance(@Scope() s: AccessScope, @Body(new ZodPipe(balanceBody)) b: z.infer<typeof balanceBody>) {
    return this.absences.setBalance(s, b);
  }
}
