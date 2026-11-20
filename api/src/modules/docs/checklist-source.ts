import { and, asc, eq, isNull } from 'drizzle-orm';
import { pickChecklistTemplate, type ChecklistAnswer, type ChecklistItem } from '@schroeder/shared';
import type { Db, Tx } from '../../db/client.js';
import { bcChecklistLine, checklistTemplate, machine, serviceOrderItem, setting } from '../../db/schema.js';

export interface ChecklistDef {
  source: 'bc' | 'app';
  templateId: string | null;
  title: string;
  items: ChecklistItem[];
  /** Answers already stored in BC (source 'bc') – the starting point on the device. */
  bcAnswers: Record<string, ChecklistAnswer>;
  /** line id → bc_checklist_line.id, for writing the answers back. */
  lineIds: Record<string, string>;
}

const ANSWER = { None: 'none', Text: 'text', Number: 'number', Option: 'option' } as const;

/**
 * The checklist of an order (E-67): the yellow card lines of the BC service order if BC has them (OP-44),
 * otherwise the most specific app template; null if neither applies.
 */
export async function checklistFor(
  tx: Tx | Db,
  order: { id: string; bcNo: string; bcCompanyId: string; locationId: string; orderTypeCode: string },
): Promise<ChecklistDef | null> {
  // Setting `checklist.bcLines` (default on): off = only app templates, e.g. before the BC extension is live.
  const [cfg] = await tx
    .select({ value: setting.value })
    .from(setting)
    .where(and(eq(setting.key, 'checklist'), isNull(setting.locationId)));
  const useBc = (cfg?.value as { bcLines?: boolean } | undefined)?.bcLines !== false;
  const lines = !useBc
    ? []
    : await tx
        .select()
        .from(bcChecklistLine)
        .where(
          and(eq(bcChecklistLine.bcCompanyId, order.bcCompanyId), eq(bcChecklistLine.orderNo, order.bcNo)),
        )
        .orderBy(asc(bcChecklistLine.lineNo));
  if (lines.length) {
    const items: ChecklistItem[] = [];
    const bcAnswers: Record<string, ChecklistAnswer> = {};
    const lineIds: Record<string, string> = {};
    for (const l of lines) {
      const id = `bc:${l.lineNo}`;
      lineIds[id] = l.id;
      items.push({
        id,
        text: l.description,
        kind: l.lineType === 'Heading' ? 'heading' : 'line',
        checkbox: l.inputEnabled,
        answer: ANSWER[l.answerType as keyof typeof ANSWER] ?? 'none',
        ...(l.options.length ? { options: l.options } : {}),
        unit: l.unit || null,
        ...(l.unitOptions.length ? { unitOptions: l.unitOptions } : {}),
        required: l.required,
      });
      if (l.checked || l.answer)
        bcAnswers[id] = { checked: l.checked, value: l.answer || null, unit: l.answerUnit || null };
    }
    return { source: 'bc', templateId: null, title: 'Servicecheckliste', items, bcAnswers, lineIds };
  }
  const [m] = await tx
    .select({ brand: machine.brand })
    .from(serviceOrderItem)
    .innerJoin(machine, eq(machine.id, serviceOrderItem.machineId))
    .where(eq(serviceOrderItem.orderId, order.id))
    .limit(1);
  const templates = await tx.select().from(checklistTemplate).where(eq(checklistTemplate.active, true));
  const tpl = pickChecklistTemplate(templates, {
    locationId: order.locationId,
    orderTypeCode: order.orderTypeCode,
    brand: m?.brand ?? null,
  });
  return tpl
    ? { source: 'app', templateId: tpl.id, title: tpl.title, items: tpl.items, bcAnswers: {}, lineIds: {} }
    : null;
}
