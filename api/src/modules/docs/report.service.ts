import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import {
  DEFAULT_REQUIRED_FIELDS,
  REQUIRED_FIELD_DEFS,
  localDate,
  reportCompleteness,
  wrapForBc,
  type CommandPayload,
} from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import type { Tx } from '../../db/client.js';
import {
  auditLog,
  location,
  orderStatusEvent,
  serviceOrder,
  setting,
  textTemplate,
  workReport,
} from '../../db/schema.js';
import { CommandRejected } from '../sync/command-rejected.js';
import type { TransferService } from '../transfer/transfer.service.js';

type OrderAccess = (orderId: string) => Promise<'assigned' | 'former' | 'none'>;

/**
 * Work report (PROMPT 5.6): free text + required fields per order type + quick documentation templates.
 * Coupled with the order status: "Fertig" with incomplete documentation becomes "Fertig – Doku offen", and
 * completing the documentation moves the order on to "Fertig". After the Meister's approval the report goes to
 * BC as service comment lines (80 characters each).
 */
@Injectable()
export class ReportService {
  async requiredFields(tx: Tx, locationId: string, orderTypeCode: string): Promise<string[]> {
    const rows = await tx
      .select()
      .from(setting)
      .where(
        and(
          eq(setting.key, 'reportRequiredFields'),
          or(isNull(setting.locationId), eq(setting.locationId, locationId)),
        ),
      );
    const cfg =
      ((rows.find((r) => r.locationId === locationId) ?? rows[0])?.value as
        Record<string, string[]> | undefined) ?? DEFAULT_REQUIRED_FIELDS;
    return (cfg[orderTypeCode] ?? []).filter((f) => f in REQUIRED_FIELD_DEFS);
  }

  async completeness(tx: Tx, orderId: string) {
    const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, orderId));
    if (!order) return { complete: false, missing: ['Auftrag'] };
    const [r] = await tx.select().from(workReport).where(eq(workReport.orderId, orderId));
    return reportCompleteness(
      r ? { body: r.body, requiredFields: r.requiredFields } : null,
      await this.requiredFields(tx, order.locationId, order.orderTypeCode),
    );
  }

  async save(
    tx: Tx,
    scope: AccessScope,
    deviceTime: Date,
    p: CommandPayload<'SaveWorkReport'>,
    access: OrderAccess,
  ): Promise<string[]> {
    if ((await access(p.orderId)) === 'none')
      throw new CommandRejected('Auftrag nicht gefunden oder nicht zugewiesen');
    const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, p.orderId));
    if (!order) throw new CommandRejected('Auftrag nicht gefunden');
    if (order.appStatus === 'FREIGEGEBEN' || order.appStatus === 'ABGERECHNET')
      throw new CommandRejected(
        'Der Auftrag ist bereits freigegeben – der Bericht kann nicht mehr geändert werden',
      );
    const [existing] = await tx
      .select()
      .from(workReport)
      .where(eq(workReport.orderId, p.orderId))
      .for('update');
    // Last writer wins by device time; an older offline version must not overwrite a newer one.
    if (existing?.deviceTime && existing.deviceTime > deviceTime) {
      await tx
        .insert(auditLog)
        .values({
          actorId: scope.userId,
          action: 'REPORT_OUTDATED_VERSION',
          entity: 'work_report',
          entityId: existing.id,
          newValue: p,
        });
      return [
        'Auf einem anderen Gerät wurde der Bericht später geändert – diese ältere Fassung wurde nur archiviert.',
      ];
    }
    const required = await this.requiredFields(tx, order.locationId, order.orderTypeCode);
    const c = reportCompleteness({ body: p.body, requiredFields: p.requiredFields }, required);
    const values = {
      orderId: p.orderId,
      authorId: scope.userId,
      body: p.body,
      requiredFields: p.requiredFields,
      usedTemplateIds: p.usedTemplateIds,
      complete: c.complete,
      completedAt: c.complete ? (existing?.completedAt ?? new Date()) : null,
      deviceTime,
    };
    if (existing) {
      if (existing.body !== p.body && existing.authorId !== scope.userId)
        await tx
          .insert(auditLog)
          .values({
            actorId: scope.userId,
            action: 'REPORT_OVERWRITE',
            entity: 'work_report',
            entityId: existing.id,
            oldValue: { body: existing.body, authorId: existing.authorId },
          });
      await tx.update(workReport).set(values).where(eq(workReport.id, existing.id));
    } else await tx.insert(workReport).values({ id: crypto.randomUUID(), ...values });

    if (c.complete && order.appStatus === 'FERTIG_DOKU_OFFEN') {
      await tx.update(serviceOrder).set({ appStatus: 'FERTIG' }).where(eq(serviceOrder.id, order.id));
      await tx
        .insert(orderStatusEvent)
        .values({
          orderId: order.id,
          fromStatus: order.appStatus,
          toStatus: 'FERTIG',
          actorId: scope.userId,
          source: 'DOKU',
          deviceTime,
        });
    }
    return [];
  }

  /** Comment lines for BC, enqueued before the status transfer of the same order (same group → in order). */
  async enqueueComments(tx: Tx, transfers: TransferService, orderId: string) {
    const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, orderId));
    const [r] = await tx.select().from(workReport).where(eq(workReport.orderId, orderId));
    if (!order || !r || !r.body.trim()) return 0;
    const [loc] = await tx.select().from(location).where(eq(location.id, order.locationId));
    const facts = Object.entries(r.requiredFields)
      .filter(([, v]) => v !== null && v !== '')
      .map(
        ([k, v]) =>
          `${REQUIRED_FIELD_DEFS[k]?.label ?? k}: ${typeof v === 'number' ? v.toLocaleString('de-DE') : v}${REQUIRED_FIELD_DEFS[k]?.unit ? ` ${REQUIRED_FIELD_DEFS[k]!.unit}` : ''}`,
      );
    const lines = wrapForBc([r.body, ...(facts.length ? ['', ...facts] : [])].join('\n'));
    const date = localDate(r.completedAt ?? new Date(), loc!.timezone);
    for (const comment of lines)
      await transfers.enqueue(tx, {
        locationId: order.locationId,
        bcCompanyId: order.bcCompanyId,
        target: 'COMMENT',
        subjectType: 'work_report',
        subjectId: r.id,
        groupKey: `order:${orderId}`,
        payload: {
          op: 'create',
          endpoint: 'serviceCommentLines',
          body: {
            type: 'Resolution',
            documentNumber: order.bcNo,
            serviceItemLineNumber: 10000,
            date,
            comment: comment || ' ',
          },
        },
      });
    await tx.update(workReport).set({ state: 'APPROVED' }).where(eq(workReport.id, r.id));
    return lines.length;
  }

  /** Templates for a location (global ones have no location). */
  templates(tx: Tx, locationId: string) {
    return tx
      .select()
      .from(textTemplate)
      .where(
        and(
          eq(textTemplate.active, true),
          or(isNull(textTemplate.locationId), eq(textTemplate.locationId, locationId)),
        ),
      )
      .orderBy(asc(textTemplate.sortOrder), asc(textTemplate.title));
  }
}
