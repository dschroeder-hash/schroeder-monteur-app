'use client';

import { localDate } from '@schroeder/shared';
import { Clock, FileWarning, PackageSearch, Thermometer } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { OrderCard } from '@/components/OrderCard';
import { SickReportDialog } from '@/components/SickReportDialog';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth/AuthProvider';
import { fmtMinutes } from '@/lib/format';
import { useDaySummary, useMyOrders, useTimezone } from '@/lib/offline/hooks';

const DONE = new Set(['FERTIG', 'FREIGEGEBEN', 'ABGERECHNET']);

function greeting(d: Date, tz: string) {
  const h = Number(
    new Intl.DateTimeFormat('de-DE', { hour: 'numeric', hour12: false, timeZone: tz }).format(d),
  );
  return h < 11 ? 'Guten Morgen' : h < 17 ? 'Guten Tag' : 'Guten Abend';
}

function Chip({
  href,
  icon,
  label,
  value,
  warn,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
  value: string;
  warn?: boolean;
}) {
  const body = (
    <div
      className={`flex min-h-touch items-center gap-3 rounded-card border-2 px-4 py-2 ${warn ? 'border-warning bg-warning-bg text-warning' : 'border-border bg-surface'}`}
    >
      {icon}
      <span className="text-sm font-semibold">{label}</span>
      <span className="ml-auto text-xl font-bold tabular-nums">{value}</span>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-card">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Monteur start page: today's orders first, only the figures that need attention (read from the offline cache). */
export default function MonteurDashboard() {
  const { me } = useAuth();
  const tz = useTimezone();
  const orders = useMyOrders(me?.id);
  const now = new Date();
  const today = localDate(now, tz);
  const day = useDaySummary(me?.id);
  const startOf = (o: (typeof orders)[number]) => o.assignments[0]?.plannedStart ?? '';
  const due = orders
    .filter((o) => o.assignments.some((a) => localDate(new Date(a.plannedStart), tz) === today))
    .sort((a, b) => startOf(a).localeCompare(startOf(b)));
  const others = orders
    .filter((o) => !due.includes(o) && !DONE.has(o.appStatus))
    .sort((a, b) => startOf(a).localeCompare(startOf(b)));
  const waitingParts = orders.filter((o) => o.appStatus === 'WARTET_TEILE').length;
  const docsOpen = orders.filter((o) => o.appStatus === 'FERTIG_DOKU_OFFEN').length;
  const [sick, setSick] = useState(false);
  const firstName = me?.displayName.split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-semibold text-text-muted">
            {new Intl.DateTimeFormat('de-DE', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: tz,
            }).format(now)}
          </p>
          <h1 className="font-headline text-3xl">
            {greeting(now, tz)}, {firstName}
          </h1>
        </div>
        {me?.features['absence.sick'] && (
          <Button variant="secondary" onClick={() => setSick(true)}>
            <Thermometer aria-hidden className="h-5 w-5" />
            Krank melden
          </Button>
        )}
      </div>
      {sick && <SickReportDialog onClose={() => setSick(false)} />}

      <section aria-label="Auf einen Blick" className="grid gap-3 sm:grid-cols-3">
        {me?.features.stamping && (
          <Chip
            href="/monteur/zeiten"
            icon={<Clock aria-hidden className="h-6 w-6 text-accent" />}
            label="Arbeitszeit heute"
            value={fmtMinutes(day.workMinutes)}
            warn={day.warnings.length > 0}
          />
        )}
        {waitingParts > 0 && (
          <Chip
            icon={<PackageSearch aria-hidden className="h-6 w-6" />}
            label="Wartet auf Teile"
            value={String(waitingParts)}
            warn
          />
        )}
        {docsOpen > 0 && (
          <Chip
            icon={<FileWarning aria-hidden className="h-6 w-6" />}
            label="Dokumentation offen"
            value={String(docsOpen)}
            warn
          />
        )}
      </section>

      <section aria-labelledby="heute" className="flex flex-col gap-3">
        <h2 id="heute" className="text-xl font-bold">
          Heute fällig ({due.length})
        </h2>
        {due.map((o) => (
          <OrderCard key={o.id} order={o} tz={tz} />
        ))}
        {due.length === 0 && (
          <p className="rounded-card border border-dashed border-border bg-surface p-6 text-center text-text-muted">
            Heute sind Ihnen keine Aufträge zugewiesen.
          </p>
        )}
      </section>

      {others.length > 0 && (
        <section aria-labelledby="weitere" className="flex flex-col gap-3">
          <h2 id="weitere" className="text-xl font-bold">
            Weitere offene Aufträge ({others.length})
          </h2>
          {others.map((o) => (
            <OrderCard key={o.id} order={o} tz={tz} />
          ))}
        </section>
      )}
    </div>
  );
}
