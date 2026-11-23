import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_REQUIRED_FIELDS,
  REQUIRED_FIELD_DEFS,
  checklistLines,
  checklistItemsFor,
  checklistMissing,
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
  orderChecklist,
  orderSignature,
  orderStatusEvent,
  serviceOrder,
  setting,
  textTemplate,
  workReport,
} from '../../db/schema.js';
import { checklistFor } from './checklist-source.js';
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

  /**
   * Everything "Arbeit abgeschlossen" needs: report with required fields and the customer's signature or the reason why there is none (setting
   * `completion.signatureRequired`, default on – E-68).
   */
  async completeness(tx: Tx, orderId: string) {
    const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, orderId));
    if (!order) return { complete: false, missing: ['Auftrag'] };
    const [r] = await tx.select().from(workReport).where(eq(workReport.orderId, orderId));
    const report = reportCompleteness(
      r ? { body: r.body, requiredFields: r.requiredFields } : null,
      await this.requiredFields(tx, order.locationId, order.orderTypeCode),
    );
    const missing = [...report.missing];
    // The service checklist is optional (customer decision, E-79): it never blocks "Arbeit abgeschlossen".
    if (await this.signatureRequired(tx, order.locationId)) {
      const [sig] = await tx.select().from(orderSignature).where(eq(orderSignature.orderId, orderId));
      if (!sig) missing.push('Unterschrift des Kunden');
    }
    return { complete: missing.length === 0, missing };
  }

  private async signatureRequired(tx: Tx, locationId: string): Promise<boolean> {
    const rows = await tx
      .select()
      .from(setting)
      .where(
        and(
          eq(setting.key, 'completion'),
          or(eq(setting.locationId, locationId), isNull(setting.locationId)),
        ),
      );
    const v = (rows.find((r) => r.locationId === locationId) ?? rows[0])?.value as
      { signatureRequired?: boolean } | undefined;
    return v?.signatureRequired ?? true;
  }

  /** "Fertig – Doku offen" moves on to "Fertig" as soon as the last missing piece arrives. */
  private async promoteIfComplete(tx: Tx, scope: AccessScope, orderId: string, deviceTime: Date) {
    const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, orderId));
    if (order?.appStatus !== 'FERTIG_DOKU_OFFEN' || !(await this.completeness(tx, orderId)).complete) return;
    await tx.update(serviceOrder).set({ appStatus: 'FERTIG' }).where(eq(serviceOrder.id, order.id));
    await tx.insert(orderStatusEvent).values({
      orderId: order.id,
      fromStatus: order.appStatus,
      toStatus: 'FERTIG',
      actorId: scope.userId,
      source: 'DOKU',
      deviceTime,
    });
  }

  private async editableOrder(orderId: string, access: OrderAccess, tx: Tx) {
    if ((await access(orderId)) === 'none')
      throw new CommandRejected('Auftrag nicht gefunden oder nicht zugewiesen');
    const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, orderId));
    if (!order) throw new CommandRejected('Auftrag nicht gefunden');
    if (order.appStatus === 'FREIGEGEBEN' || order.appStatus === 'ABGERECHNET')
      throw new CommandRejected('Der Auftrag ist bereits abgeschlossen und übertragen');
    return order;
  }

  /** Service checklist of an order (E-67); whole document, the newest device time wins. */
  async saveChecklist(
    tx: Tx,
    scope: AccessScope,
    deviceTime: Date,
    p: CommandPayload<'SaveChecklist'>,
    access: OrderAccess,
  ): Promise<string[]> {
    const order = await this.editableOrder(p.orderId, access, tx);
    const def = await checklistFor(tx, order);
    if (!def || def.templateId !== p.templateId)
      throw new CommandRejected('Die Checkliste dieses Auftrags hat sich geändert – bitte neu laden');
    const [existing] = await tx
      .select()
      .from(orderChecklist)
      .where(eq(orderChecklist.orderId, p.orderId))
      .for('update');
    if (existing?.deviceTime && existing.deviceTime > deviceTime)
      return [
        'Auf einem anderen Gerät wurde die Checkliste später geändert – diese Fassung wurde verworfen.',
      ];
    const known = new Set(def.items.filter((i) => i.kind === 'line').map((i) => i.id));
    const results = Object.fromEntries(Object.entries(p.results).filter(([k]) => known.has(k)));
    const values = {
      orderId: p.orderId,
      templateId: def.templateId,
      source: def.source,
      authorId: scope.userId,
      results,
      complete:
        checklistMissing(checklistItemsFor(def.items, order.orderTypeCode), { ...def.bcAnswers, ...results })
          .length === 0,
      deviceTime,
    };
    if (existing) await tx.update(orderChecklist).set(values).where(eq(orderChecklist.id, existing.id));
    else await tx.insert(orderChecklist).values({ id: randomUUID(), ...values });
    await this.promoteIfComplete(tx, scope, p.orderId, deviceTime);
    return [];
  }

  /** Customer signature (E-68). A later signature replaces an earlier one (e.g. signed again after changes). */
  async sign(
    tx: Tx,
    scope: AccessScope,
    deviceTime: Date,
    p: CommandPayload<'SignOrder'>,
    access: OrderAccess,
  ): Promise<string[]> {
    await this.editableOrder(p.orderId, access, tx);
    const values = {
      orderId: p.orderId,
      authorId: scope.userId,
      signerName: p.signerName,
      signedAt: new Date(p.signedAt),
      imagePng: p.imagePng ?? null,
      absentReason: p.imagePng ? null : (p.absentReason ?? null),
      deviceTime,
    };
    await tx
      .insert(orderSignature)
      .values(values)
      .onConflictDoUpdate({ target: orderSignature.orderId, set: values });
    await tx.insert(auditLog).values({
      actorId: scope.userId,
      action: p.imagePng ? 'ORDER_SIGNED' : 'ORDER_NOT_SIGNED',
      entity: 'service_order',
      entityId: p.orderId,
      newValue: { signerName: p.signerName, signedAt: p.signedAt, absentReason: values.absentReason },
    });
    await this.promoteIfComplete(tx, scope, p.orderId, deviceTime);
    return [];
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
      await tx.insert(auditLog).values({
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
        await tx.insert(auditLog).values({
          actorId: scope.userId,
          action: 'REPORT_OVERWRITE',
          entity: 'work_report',
          entityId: existing.id,
          oldValue: { body: existing.body, authorId: existing.authorId },
        });
      await tx.update(workReport).set(values).where(eq(workReport.id, existing.id));
    } else await tx.insert(workReport).values({ id: crypto.randomUUID(), ...values });

    if (c.complete) await this.promoteIfComplete(tx, scope, order.id, deviceTime);
    return [];
  }

  /** Comment lines for BC, enqueued before the status transfer of the same order (same group → in order). */
  /**
   * Hand-over of the documentation to BC (same group as the status → BC receives it first): work report and
   * service checklist as comment lines (80 characters each), then the signed workshop order as PDF attachment
   * (E-68; the PDF is built by the transfer worker at send time).
   */
  async enqueueComments(tx: Tx, transfers: TransferService, orderId: string) {
    const [order] = await tx.select().from(serviceOrder).where(eq(serviceOrder.id, orderId));
    if (!order) return 0;
    const [loc] = await tx.select().from(location).where(eq(location.id, order.locationId));
    const [r] = await tx.select().from(workReport).where(eq(workReport.orderId, orderId));
    const date = localDate(r?.completedAt ?? new Date(), loc!.timezone);
    const comment = (subjectType: string, subjectId: string, text: string, type: 'Resolution' | 'General') =>
      transfers.enqueue(tx, {
        locationId: order.locationId,
        bcCompanyId: order.bcCompanyId,
        target: 'COMMENT',
        subjectType,
        subjectId,
        groupKey: `order:${orderId}`,
        payload: {
          op: 'create',
          endpoint: 'serviceCommentLines',
          body: {
            type,
            documentNumber: order.bcNo,
            serviceItemLineNumber: 10000,
            date,
            comment: text || ' ',
          },
        },
      });
    let count = 0;

    if (r && r.body.trim()) {
      const facts = Object.entries(r.requiredFields)
        .filter(([, v]) => v !== null && v !== '')
        .map(
          ([k, v]) =>
            `${REQUIRED_FIELD_DEFS[k]?.label ?? k}: ${typeof v === 'number' ? v.toLocaleString('de-DE') : v}${REQUIRED_FIELD_DEFS[k]?.unit ? ` ${REQUIRED_FIELD_DEFS[k]!.unit}` : ''}`,
        );
      const lines = wrapForBc([r.body, ...(facts.length ? ['', ...facts] : [])].join('\n'));
      for (const line of lines) await comment('work_report', r.id, line, 'Resolution');
      await tx.update(workReport).set({ state: 'APPROVED' }).where(eq(workReport.id, r.id));
      count += lines.length;
    }

    const [cl] = await tx.select().from(orderChecklist).where(eq(orderChecklist.orderId, orderId));
    const def = cl ? await checklistFor(tx, order) : null;
    if (cl && def?.source === 'bc') {
      // Yellow card in BC (OP-44): every answered line goes back into the BC checklist itself.
      for (const [lineId, a] of Object.entries(cl.results)) {
        const ref = def.lineIds[lineId];
        if (!ref) continue;
        await transfers.enqueue(tx, {
          locationId: order.locationId,
          bcCompanyId: order.bcCompanyId,
          target: 'CHECKLIST',
          subjectType: 'order_checklist',
          subjectId: cl.id,
          groupKey: `order:${orderId}`,
          payload: {
            op: 'patch',
            endpoint: 'serviceChecklistLines',
            ref: { table: 'bc_checklist_line', id: ref },
            body: { checked: a.checked, answer: a.value ?? '', answerUnit: a.unit ?? '' },
          },
        });
        count++;
      }
    } else if (cl && def) {
      const lines = wrapForBc(
        [`Checkliste: ${def.title}`, ...checklistLines(def.items, cl.results)].join('\n'),
      );
      for (const line of lines) await comment('order_checklist', cl.id, line, 'General');
      count += lines.length;
    }

    const [sig] = await tx
      .select({ orderId: orderSignature.orderId })
      .from(orderSignature)
      .where(eq(orderSignature.orderId, orderId));
    if (sig || r || cl) {
      await transfers.enqueue(tx, {
        locationId: order.locationId,
        bcCompanyId: order.bcCompanyId,
        target: 'ATTACHMENT',
        subjectType: 'service_order',
        subjectId: orderId,
        groupKey: `order:${orderId}`,
        payload: {
          op: 'create',
          endpoint: 'serviceOrderAttachments',
          body: {
            documentNumber: order.bcNo,
            fileName: `Werkstattauftrag_${order.bcNo}.pdf`,
            fileContent: '',
          },
          meta: { workOrderPdfOf: orderId },
        },
      });
      count++;
    }
    return count;
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
