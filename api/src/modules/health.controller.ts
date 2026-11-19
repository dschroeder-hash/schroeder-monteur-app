import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/decorators.js';
import { DB } from '../db/db.module.js';
import type { Db } from '../db/client.js';

@ApiTags('Betrieb')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
