'use client';

import {
  checklistItemsFor,
  checklistMissing,
  pickChecklistTemplate,
  type ChecklistAnswer,
} from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';
import { localDb } from './db';
import { useSync } from './SyncProvider';

/**
 * Service checklist of an order (E-67): the yellow card from BC wins, otherwise the most specific app template.
 * Filled in during the work (it is working time), checked again before "Arbeit abgeschlossen".
 */
export function useOrderChecklist(orderId: string) {
  const { run } = useSync();
  const order = useLiveQuery(() => localDb.orders.get(orderId), [orderId]);
  const templates =
    useLiveQuery(() => localDb.checklistTemplates.filter((t) => t.active).toArray(), []) ?? [];
  const checklist = useLiveQuery(() => localDb.orderChecklists.get(orderId), [orderId]);
  const bcDef = useLiveQuery(() => localDb.checklistDefs.get(orderId), [orderId]);
  const loaded = useLiveQuery(async () => true, []);

  const appTpl = order
    ? pickChecklistTemplate(templates, {
        locationId: order.locationId,
        orderTypeCode: order.orderTypeCode,
        brand: order.items[0]?.machine?.brand ?? null,
      })
    : null;
  const tpl = bcDef
    ? { id: null, title: bcDef.title, items: bcDef.items, initial: bcDef.bcAnswers }
    : appTpl
      ? { id: appTpl.id, title: appTpl.title, items: appTpl.items, initial: {} }
      : null;
  const tplId = tpl?.id;
  const hasTpl = !!tpl;
  const save = useCallback(
    (results: Record<string, ChecklistAnswer>) => {
      if (hasTpl) void run('SaveChecklist', { orderId, templateId: tplId ?? null, results });
    },
    [run, orderId, tplId, hasTpl],
  );
  const items = tpl && order ? checklistItemsFor(tpl.items, order.orderTypeCode) : [];
  const answers: Record<string, ChecklistAnswer> = tpl
    ? { ...tpl.initial, ...(checklist && checklist.templateId === tpl.id ? checklist.results : {}) }
    : {};
  const openItems = tpl ? checklistMissing(items, answers) : [];
  return {
    order,
    loaded: !!loaded && order !== undefined,
    tpl,
    items,
    answers,
    openItems,
    started: !!checklist,
    done: !tpl || openItems.length === 0,
    save,
  };
}
