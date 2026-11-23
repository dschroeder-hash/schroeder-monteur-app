import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

/**
 * Way back from a sub page of an order (report, parts, oil shop, checklist …). Needed on the iPad: the app runs
 * from the home screen without browser buttons.
 */
export function BackLink({ orderId }: { orderId?: string | null }) {
  return (
    <Link
      href={orderId ? `/monteur/auftrag?id=${orderId}` : '/monteur'}
      className="-ml-1 inline-flex min-h-touch items-center gap-2 self-start rounded-card px-1 font-semibold text-primary"
    >
      <ArrowLeft aria-hidden className="h-5 w-5" />
      {orderId ? 'Zurück zum Auftrag' : 'Zurück zur Übersicht'}
    </Link>
  );
}
