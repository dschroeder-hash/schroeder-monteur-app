'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { Mail, MessageSquareText, Phone, Smartphone, Users } from 'lucide-react';
import { telLink } from '@/lib/format';
import { localDb, type LocalOrder, type LocalRemark } from '@/lib/offline/db';

const KIND: Record<string, string> = {
  General: 'Allgemein',
  Fault: 'Fehler',
  Resolution: 'Lösung',
  Accessory: 'Zubehör',
  Internal: 'Intern',
  'Service Item Loaner': 'Leihgerät',
};

/**
 * Remarks from BC (customer, machine, order) and the customer's contact persons – read only, available offline
 * (E-70). Collapsed by default so the order page stays short.
 */
export function OrderInfo({ order }: { order: LocalOrder }) {
  const machineNos = order.items.map((i) => i.machine?.serviceItemNo).filter((x): x is string => !!x);
  const remarks =
    useLiveQuery(async () => {
      const all = await localDb.remarks.toArray();
      return all
        .filter(
          (r) =>
            (r.scope === 'CUSTOMER' && r.refNo === order.customerNo) ||
            (r.scope === 'SERVICE_ITEM' && machineNos.includes(r.refNo)) ||
            (r.scope === 'ORDER' && r.refNo === order.bcNo),
        )
        .sort((a, b) => a.lineNo - b.lineNo);
    }, [order.customerNo, order.bcNo, machineNos.join(',')]) ?? [];
  const contacts =
    useLiveQuery(
      () => localDb.contacts.where('customerNo').equals(order.customerNo).toArray(),
      [order.customerNo],
    ) ?? [];
  const groups: Array<[string, LocalRemark[]]> = [
    ['Kunde', remarks.filter((r) => r.scope === 'CUSTOMER')],
    ['Maschine', remarks.filter((r) => r.scope === 'SERVICE_ITEM')],
    ['Auftrag', remarks.filter((r) => r.scope === 'ORDER')],
  ];
  const link = 'inline-flex min-h-touch items-center gap-2 font-semibold underline';

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <details
        className="rounded-card border border-border bg-surface p-4"
        open={remarks.length > 0 && remarks.length <= 3}
      >
        <summary className="flex min-h-touch cursor-pointer items-center gap-2 font-bold">
          <MessageSquareText aria-hidden className="h-5 w-5 text-accent" /> Bemerkungen ({remarks.length})
        </summary>
        {remarks.length === 0 && <p className="text-text-muted">Keine Bemerkungen in Business Central.</p>}
        {groups
          .filter(([, list]) => list.length)
          .map(([title, list]) => (
            <section key={title} className="mt-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
              <ul className="flex flex-col gap-1">
                {list.map((r) => (
                  <li key={r.id}>
                    {r.scope !== 'CUSTOMER' && r.kind !== 'General' && (
                      <span className="mr-1 text-sm font-semibold">{KIND[r.kind] ?? r.kind}:</span>
                    )}
                    {r.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </details>
      <details className="rounded-card border border-border bg-surface p-4">
        <summary className="flex min-h-touch cursor-pointer items-center gap-2 font-bold">
          <Users aria-hidden className="h-5 w-5 text-accent" /> Kontakte des Kunden ({contacts.length})
        </summary>
        {contacts.length === 0 && <p className="text-text-muted">Keine Kontakte hinterlegt.</p>}
        <ul className="flex flex-col divide-y divide-border">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-col py-2">
              <span className="font-semibold">
                {c.name}
                {c.jobTitle && <span className="font-normal text-text-muted"> · {c.jobTitle}</span>}
              </span>
              <span className="flex flex-wrap gap-x-4">
                {c.phone && (
                  <a className={link} href={telLink(c.phone)}>
                    <Phone aria-hidden className="h-4 w-4" /> {c.phone}
                  </a>
                )}
                {c.mobile && (
                  <a className={link} href={telLink(c.mobile)}>
                    <Smartphone aria-hidden className="h-4 w-4" /> {c.mobile}
                  </a>
                )}
                {c.email && (
                  <a className={link} href={`mailto:${c.email}`}>
                    <Mail aria-hidden className="h-4 w-4" /> {c.email}
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
