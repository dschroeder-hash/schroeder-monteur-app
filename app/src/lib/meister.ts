'use client';

import { useAuth } from './auth/AuthProvider';

/** Locations where the signed-in user acts as Meister (first one is the default). */
export function useMeisterLocations() {
  const { me } = useAuth();
  return (me?.grants ?? [])
    .filter((g) => g.role === 'MEISTER')
    .map((g) => ({ id: g.locationId, name: g.location?.name ?? g.locationId }));
}
