'use client';

import { TemplatesEditor } from '@/components/TemplatesEditor';
import { useMeisterLocations } from '@/lib/meister';

/** Meister maintains the quick documentation templates of the own location(s) (PROMPT 5.6). */
export default function MeisterTemplatesPage() {
  const locations = useMeisterLocations();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-headline text-2xl">Textbausteine</h1>
      {locations.length > 0 && <TemplatesEditor locations={locations} allowGlobal={false} />}
    </div>
  );
}
