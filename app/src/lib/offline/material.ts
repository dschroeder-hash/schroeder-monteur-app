'use client';

import { availableQuantity, normalizePartNo } from '@schroeder/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb, type LocalItem, type LocalStorage } from './db';

export interface ItemWithStock extends LocalItem {
  stock: Array<{ storage: LocalStorage; available: number; minStock: number | null }>;
}

/** Offline search in the cached catalog: barcode, normalised part number prefix or name. */
export async function searchLocal(text: string, limit = 30): Promise<ItemWithStock[]> {
  const t = text.trim();
  if (!t) return [];
  const norm = normalizePartNo(t);
  const byCode = await localDb.items.where('barcodes').equals(t).or('gtin').equals(t).toArray();
  const lower = t.toLowerCase();
  const rest = await localDb.items
    .filter(
      (i) =>
        !i.blocked && (normalizePartNo(i.number).startsWith(norm) || i.name.toLowerCase().includes(lower)),
    )
    .limit(limit)
    .toArray();
  const seen = new Set<string>();
  const items = [...byCode, ...rest].filter((i) => !seen.has(i.id) && seen.add(i.id)).slice(0, limit);
  return withStock(items);
}

export async function withStock(items: LocalItem[]): Promise<ItemWithStock[]> {
  const storages = await localDb.storages.toArray();
  const stocks = await localDb.stocks
    .where('itemId')
    .anyOf(items.map((i) => i.id))
    .toArray();
  return items.map((i) => ({
    ...i,
    stock: stocks
      .filter((s) => s.itemId === i.id)
      .map((s) => ({
        storage: storages.find((x) => x.id === s.storageLocationId)!,
        available: availableQuantity(s.bcInventory, s.pendingWithdrawal),
        minStock: s.minStock,
      }))
      .filter((s) => s.storage),
  }));
}

/** Storages a Monteur takes from: location warehouse and the service vans. */
export function useStorages() {
  return useLiveQuery(() => localDb.storages.toArray(), []) ?? [];
}

export const STORAGE_LABEL = { LAGER: 'Lager', SERVICEWAGEN: 'Servicewagen', TANK: 'Tankanlage' } as const;
