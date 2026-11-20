'use client';

import { checklistMissing, pickChecklistTemplate, type ChecklistAnswer } from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { CircleCheck, CircleAlert, ClipboardCheck, PenLine } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';
import { ChecklistForm } from '@/components/ChecklistForm';
import { SignaturePad } from '@/components/SignaturePad';
import { toast } from '@/components/Toast';
import { Button } from '@/components/ui/Button';
import { WorkOrderSheet } from '@/components/WorkOrderSheet';
import { localDb } from '@/lib/offline/db';
import { useSync } from '@/lib/offline/SyncProvider';

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`step-${n}`} className="flex flex-col gap-3">
      <h2 id={`step-${n}`} className="flex items-center gap-2 text-xl font-bold">
        {done ? (
          <CircleCheck aria-label="erledigt" className="h-7 w-7 text-success" />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-on-primary">
            {n}
          </span>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * "Arbeit abgeschlossen" (E-66 to E-68): check the workshop order, fill in the service checklist, let the customer
 * sign – then the order is finished and handed over to BC automatically. Works offline.
 */
function Completion() {
  const orderId = useSearchParams().get('orderId') ?? '';
  const router = useRouter();
  const { run } = useSync();
  const order = useLiveQuery(() => localDb.orders.get(orderId), [orderId]);
  const report = useLiveQuery(() => localDb.workReports.get(orderId), [orderId]);
  const templates =
    useLiveQuery(() => localDb.checklistTemplates.filter((t) => t.active).toArray(), []) ?? [];
  const checklist = useLiveQuery(() => localDb.orderChecklists.get(orderId), [orderId]);
  const signature = useLiveQuery(() => localDb.orderSignatures.get(orderId), [orderId]);
  const loaded = useLiveQuery(async () => true, []);
  const [png, setPng] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [absent, setAbsent] = useState(false);
  const [reason, setReason] = useState('');

  const tpl = order
    ? pickChecklistTemplate(templates, {
        locationId: order.locationId,
        orderTypeCode: order.orderTypeCode,
        brand: order.items[0]?.machine?.brand ?? null,
      })
    : null;
  const saveChecklist = useCallback(
    (results: Record<string, ChecklistAnswer>) => {
      if (tpl) void run('SaveChecklist', { orderId, templateId: tpl.id, results });
    },
    [run, orderId, tpl],
  );

  if (!order || !loaded) return <p className="text-text-muted">Wird geladen …</p>;
  const reportDone = !!report?.complete || (!!report?.body.trim() && report.pending === true);
  const openItems = tpl
    ? checklistMissing(tpl.items, checklist?.templateId === tpl.id ? checklist.results : {})
    : [];
  const checklistDone = !tpl || openItems.length === 0;
  const signed = !!signature;
  const ready = reportDone && checklistDone && signed;

  const sign = async () => {
    await run('SignOrder', {
      orderId,
      signerName: name.trim(),
      signedAt: new Date().toISOString(),
      imagePng: absent ? null : png,
      absentReason: absent ? reason.trim() : null,
    });
    toast(absent ? 'Ohne Unterschrift vermerkt' : 'Unterschrift gespeichert');
  };
  const finish = async () => {
    await run('SetOrderStatus', { orderId, status: 'FERTIG' });
    toast('Arbeit abgeschlossen – Stunden, Teile und Werkstattauftrag gehen an Business Central');
    router.push(`/monteur/auftrag?id=${orderId}`);
  };

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-sm text-text-muted">
          {order.bcNo} · {order.customerName}
        </p>
        <h1 className="font-headline text-3xl">Arbeit abschließen</h1>
      </header>

      <Step n={1} title="Werkstattauftrag prüfen" done={reportDone}>
        <WorkOrderSheet order={order} showReport />
        {!reportDone && (
          <p className="flex items-center gap-2 font-semibold text-warning">
            <CircleAlert aria-hidden className="h-5 w-5" />
            Arbeitsbericht fehlt oder ist unvollständig.{' '}
            <Link className="underline" href={`/monteur/bericht?orderId=${orderId}`}>
              Bericht schreiben
            </Link>
          </p>
        )}
      </Step>

      {tpl && (
        <Step n={2} title={`Checkliste: ${tpl.title}`} done={checklistDone}>
          <ChecklistForm
            key={tpl.id}
            items={tpl.items}
            initial={checklist?.templateId === tpl.id ? checklist.results : {}}
            onSave={saveChecklist}
          />
          {!checklistDone && (
            <p className="text-sm text-text-muted">Noch offen: {openItems.length} Punkt(e)</p>
          )}
        </Step>
      )}

      <Step n={tpl ? 3 : 2} title="Unterschrift des Kunden" done={signed}>
        {signed ? (
          <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
            {signature.imagePng && (
              <img
                src={signature.imagePng}
                alt={`Unterschrift von ${signature.signerName}`}
                className="h-24 w-auto self-start"
              />
            )}
            <p>
              {signature.absentReason
                ? `Ohne Unterschrift: ${signature.absentReason}`
                : `Unterschrieben von ${signature.signerName}, ${new Date(signature.signedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`}
            </p>
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => void localDb.orderSignatures.delete(orderId)}
            >
              Erneut unterschreiben lassen
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
            <p className="text-sm">
              Mit der Unterschrift bestätigt der Kunde die aufgeführten Arbeiten, Stunden und Teile.
            </p>
            <label className="flex items-center gap-3 font-semibold">
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={absent}
                onChange={(e) => setAbsent(e.target.checked)}
              />
              Kunde kann nicht unterschreiben
            </label>
            {absent ? (
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Grund</span>
                <input
                  className="min-h-touch rounded-card border border-border bg-surface px-3"
                  value={reason}
                  placeholder="z. B. Kunde nicht vor Ort, Maschine abgestellt"
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="font-semibold">Name des Unterzeichners</span>
                  <input
                    className="min-h-touch rounded-card border border-border bg-surface px-3"
                    value={name}
                    autoComplete="off"
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <SignaturePad onChange={setPng} />
              </>
            )}
            <Button
              disabled={absent ? reason.trim().length < 3 : !png || name.trim().length < 2}
              onClick={() => void sign()}
            >
              <PenLine aria-hidden className="h-5 w-5" />
              {absent ? 'Ohne Unterschrift vermerken' : 'Unterschrift übernehmen'}
            </Button>
          </div>
        )}
      </Step>

      <Button size="lg" disabled={!ready} onClick={() => void finish()}>
        <ClipboardCheck aria-hidden className="h-6 w-6" />
        Arbeit abgeschlossen
      </Button>
      {!ready && (
        <p className="-mt-6 text-center text-sm text-text-muted">
          Erst möglich, wenn Bericht{tpl ? ', Checkliste' : ''} und Unterschrift vorliegen.
        </p>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Completion />
    </Suspense>
  );
}
