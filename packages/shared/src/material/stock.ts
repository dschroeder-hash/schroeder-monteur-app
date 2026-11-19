/** Available stock shown in the app (ENTSCHEIDUNGEN E-16): BC inventory minus app withdrawals not yet posted in BC. */
export function availableQuantity(bcInventory: number, pendingWithdrawal: number): number {
  return Math.round((bcInventory - pendingWithdrawal) * 1000) / 1000;
}

export function belowMinimum(available: number, minStock: number | null | undefined): boolean {
  return minStock != null && available < minStock;
}

/** Plausibility of a dispensed quantity against meter readings (diesel pump), tolerance 2 % or 1 l. */
export function meterPlausible(quantity: number, before?: number | null, after?: number | null): boolean {
  if (before == null || after == null) return true;
  const diff = after - before;
  return diff >= 0 && Math.abs(diff - quantity) <= Math.max(1, quantity * 0.02);
}

/** Item categories treated as consumables (shop tiles) unless configured otherwise. */
export const DEFAULT_CONSUMABLE_CATEGORIES = ['OEL', 'FETT', 'KRAFTSTOFF'];
