import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { createDb } from './client.js';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
const DB_HANDLE = Symbol('DB_HANDLE');

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => createDb(c.DATABASE_URL, c.DB_POOL_MAX),
    },
    { provide: DB, inject: [DB_HANDLE], useFactory: (h: ReturnType<typeof createDb>) => h.db },
    { provide: PG_POOL, inject: [DB_HANDLE], useFactory: (h: ReturnType<typeof createDb>) => h.pool },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
