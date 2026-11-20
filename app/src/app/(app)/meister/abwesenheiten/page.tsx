'use client';

import { AbsenceOverview } from '@/components/AbsenceOverview';
import { useMeisterLocations } from '@/lib/meister';

/** Absences of the Meister's location with type (PROMPT 4/5.9/5.10). Decisions are made in the inbox. */
export default function MeisterAbsencesPage() {
  const locations = useMeisterLocations();
  const locationId = locations[0]?.id;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-headline text-2xl">Abwesenheiten</h1>
      <p className="text-text-muted">
        Urlaubsanträge und neue Krankmeldungen entscheiden Sie unter{' '}
        <a href="/meister/freigaben" className="font-semibold underline">
          Freigaben
        </a>
        .
      </p>
      {locationId && <AbsenceOverview locationId={locationId} />}
    </div>
  );
}
