import { Inject, Injectable } from '@nestjs/common';
import { defaultFeatureState, FEATURES, type Feature } from '@schroeder/shared';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/client.js';
import { featureFlag } from '../db/schema.js';

const GLOBAL = '*';
const CACHE_MS = 15_000;

/**
 * Feature flags per module and location (BetrVG § 87, ENTSCHEIDUNGEN E-19).
 * Resolution: location row → global row → environment default.
 */
@Injectable()
export class FeatureService {
  private cache?: { at: number; map: Map<string, boolean> };

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  invalidate() {
    this.cache = undefined;
  }

  private loading?: Promise<Map<string, boolean>>;

  /** Cached flags; concurrent callers share one reload (one connection, not one per request). */
  private async flags(): Promise<Map<string, boolean>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.map;
    this.loading ??= (async () => {
      try {
        const rows = await this.db.select().from(featureFlag);
        const map = new Map(rows.map((r) => [`${r.locationId ?? GLOBAL}:${r.feature}`, r.enabled]));
        this.cache = { at: Date.now(), map };
        return map;
      } finally {
        this.loading = undefined;
      }
    })();
    return this.loading;
  }

  async isEnabled(feature: Feature, locationId: string | null): Promise<boolean> {
    const m = await this.flags();
    if (locationId && m.has(`${locationId}:${feature}`)) return m.get(`${locationId}:${feature}`)!;
    if (m.has(`${GLOBAL}:${feature}`)) return m.get(`${GLOBAL}:${feature}`)!;
    return defaultFeatureState(feature, this.config.APP_ENV);
  }

  /** Enabled for at least one of the given locations (or globally if the user has no location). */
  async isEnabledForAny(feature: Feature, locationIds: readonly string[]): Promise<boolean> {
    if (locationIds.length === 0) return this.isEnabled(feature, null);
    for (const id of locationIds) if (await this.isEnabled(feature, id)) return true;
    return false;
  }

  async effective(locationIds: readonly string[]): Promise<Record<Feature, boolean>> {
    const out = {} as Record<Feature, boolean>;
    for (const f of FEATURES) out[f] = await this.isEnabledForAny(f, locationIds);
    return out;
  }
}
