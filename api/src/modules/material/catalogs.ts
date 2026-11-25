import { DEFAULT_CATALOGS, type CatalogDef } from '@schroeder/shared';
import { z } from 'zod';
import type { AccessScope } from '../../auth/auth.types.js';
import type { AppConfig } from '../../config.js';
import { withSession, type Db } from '../../db/client.js';
import type { MaterialService } from './material.service.js';

const catalogSchema = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9-]{2,40}$/),
    label: z.string().min(1).max(80),
    brands: z.array(z.string().max(20)).max(20).default([]),
    // https, or a path on the app's own address (test catalog in demo/tests: /v1/dev/partsbook?…)
    url: z
      .string()
      .max(2000)
      .refine(
        (u) => u.startsWith('https://') || u.startsWith('http://localhost') || /^\/[^/]/.test(u),
        'nur https',
      ),
    mode: z.enum(['iframe', 'popup']),
  }),
);

export interface CatalogSettings {
  agcoTemplate?: string;
  agcoEmbed?: boolean;
  catalogs?: unknown;
}

/** Catalogs for the user's location: setting partsCatalogs.catalogs, else env PARTS_CATALOGS, else defaults. */
export async function catalogsFor(
  db: Db,
  material: MaterialService,
  config: AppConfig,
  s: AccessScope,
): Promise<CatalogDef[]> {
  const cfg = await settingsFor(db, material, s);
  for (const candidate of [
    cfg.catalogs,
    config.PARTS_CATALOGS ? safeJson(config.PARTS_CATALOGS) : undefined,
  ]) {
    const parsed = catalogSchema.safeParse(candidate);
    if (parsed.success && parsed.data.length) return parsed.data;
  }
  return DEFAULT_CATALOGS;
}

export function settingsFor(db: Db, material: MaterialService, s: AccessScope): Promise<CatalogSettings> {
  return withSession(db, { userId: s.userId, roles: s.roles }, (tx) =>
    material.setting<CatalogSettings>(
      tx,
      s.locationIds[0] ?? '00000000-0000-0000-0000-000000000000',
      'partsCatalogs',
      {},
    ),
  );
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
