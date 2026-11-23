'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BackLink } from '@/components/BackLink';
import { ChecklistForm } from '@/components/ChecklistForm';
import { useOrderChecklist } from '@/lib/offline/checklist';

/** Service checklist during the work (it counts as working time); saved automatically, also offline. */
function ChecklistPage() {
  const orderId = useSearchParams().get('orderId') ?? '';
  const c = useOrderChecklist(orderId);
  if (!c.loaded || !c.order) return <p className="text-text-muted">Wird geladen …</p>;
  return (
    <div className="flex flex-col gap-4">
      <BackLink orderId={orderId} />
      <header>
        <p className="text-sm text-text-muted">
          {c.order.bcNo} · {c.order.customerName}
        </p>
        <h1 className="font-headline text-2xl">{c.tpl ? `Checkliste: ${c.tpl.title}` : 'Checkliste'}</h1>
      </header>
      {c.tpl ? (
        <>
          <ChecklistForm key={c.tpl.id ?? 'bc'} items={c.items} initial={c.answers} onSave={c.save} />
          {c.done ? (
            <p className="flex items-center gap-2 font-semibold text-success">
              <CircleCheck aria-hidden className="h-5 w-5" /> Checkliste vollständig – wird automatisch
              gespeichert.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-text-muted">
              <CircleAlert aria-hidden className="h-5 w-5 shrink-0 text-warning" />
              Noch offen: {c.openItems.join(', ')}. Das Ausfüllen ist freiwillig; alles wird automatisch
              gespeichert.
            </p>
          )}
          <Link
            href={`/monteur/auftrag?id=${orderId}`}
            className="inline-flex min-h-touch-lg items-center justify-center rounded-card bg-primary px-5 text-lg font-bold text-on-primary hover:bg-primary-hover"
          >
            Fertig – zurück zum Auftrag
          </Link>
        </>
      ) : (
        <p className="text-text-muted">Für diesen Auftrag ist keine Checkliste hinterlegt.</p>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChecklistPage />
    </Suspense>
  );
}
