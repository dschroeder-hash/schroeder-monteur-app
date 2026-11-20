import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ROLES } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Roles, Scope } from '../../auth/decorators.js';
import { AuditService } from '../../common/audit.service.js';
import { uuidParam, ZodBody, ZodPipe, ZodQuery } from '../../common/zod.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db } from '../../db/client.js';
import { bcTransfer, location } from '../../db/schema.js';

const listQuery = z.object({
  state: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'FAILED', 'DEAD']).optional(),
  locationId: z.string().uuid().optional(),
});
const resolveBody = z.object({ reason: z.string().trim().min(5, 'Begründung ist Pflicht').max(500) });

/** Admin view "Fehlgeschlagene Übertragungen" with resend (PROMPT 6.2). */
/**
 * The Admin repairs transfers but must not learn health-adjacent data: for absences only dates, quantity and the
 * employee are shown, never the cause (KRANK/URLAUB) or the description (DATENSCHUTZ.md).
 */
function redact<T extends { subjectType: string; payload: unknown }>(t: T): T {
  if (t.subjectType !== 'absence') return t;
  const p = t.payload as { op: string; body?: Record<string, unknown> };
  if (!p.body) return t;
  const { causeOfAbsenceCode: _c, description: _d, ...body } = p.body;
  return { ...t, payload: { ...p, body: { ...body, causeOfAbsenceCode: '***', description: '***' } } };
}

@ApiTags('Administration')
@ApiBearerAuth()
@Roles(ROLES.Admin)
@Controller('v1/admin/transfers')
export class TransfersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @ZodQuery(listQuery)
  async list(@Scope() s: AccessScope, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, (tx) =>
      tx
        .select({ t: bcTransfer, locationName: location.name })
        .from(bcTransfer)
        .leftJoin(location, eq(location.id, bcTransfer.locationId))
        .where(
          and(
            q.state
              ? eq(bcTransfer.state, q.state)
              : inArray(bcTransfer.state, ['FAILED', 'DEAD', 'PENDING', 'IN_PROGRESS']),
            q.locationId ? eq(bcTransfer.locationId, q.locationId) : undefined,
          ),
        )
        .orderBy(desc(bcTransfer.updatedAt))
        .limit(500)
        .then((rows) => rows.map((r) => ({ ...redact(r.t), locationName: r.locationName }))),
    );
  }

  /** Resend: back to PENDING with a fresh attempt counter. Safe thanks to idempotency (monteurAppId). */
  @Post(':id/retry')
  @HttpCode(200)
  async retry(@Scope() s: AccessScope, @Param('id', new ZodPipe(uuidParam)) id: string) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [old] = await tx.select().from(bcTransfer).where(eq(bcTransfer.id, id));
      if (!old) throw new NotFoundException('Übertragung nicht gefunden');
      await tx
        .update(bcTransfer)
        .set({ state: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lockedAt: null })
        .where(eq(bcTransfer.id, id));
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'TRANSFER_RETRY',
        entity: 'bc_transfer',
        entityId: id,
        oldValue: { state: old.state, lastError: old.lastError },
      });
      return { ok: true };
    });
  }

  /** Mark as handled manually in BC (unblocks the group). */
  @Post(':id/resolve')
  @HttpCode(200)
  @ZodBody(resolveBody)
  async resolve(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(resolveBody)) b: z.infer<typeof resolveBody>,
  ) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [old] = await tx.select().from(bcTransfer).where(eq(bcTransfer.id, id));
      if (!old) throw new NotFoundException('Übertragung nicht gefunden');
      await tx
        .update(bcTransfer)
        .set({ state: 'DONE', lastError: `Manuell erledigt: ${b.reason}`, lockedAt: null })
        .where(eq(bcTransfer.id, id));
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'TRANSFER_RESOLVED',
        entity: 'bc_transfer',
        entityId: id,
        oldValue: { state: old.state, lastError: old.lastError },
        reason: b.reason,
      });
      return { ok: true };
    });
  }
}
