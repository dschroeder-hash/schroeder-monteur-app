import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { APP_STATUSES, ROLES } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Roles, Scope } from '../../auth/decorators.js';
import { uuidParam, ZodPipe, ZodQuery } from '../../common/zod.js';
import { OrdersService } from './orders.service.js';

const listQuery = z.object({
  view: z.enum(['mine', 'location']).default('mine'),
  locationId: z.string().uuid().optional(),
  status: z
    .union([z.enum(APP_STATUSES), z.array(z.enum(APP_STATUSES))])
    .optional()
    .transform((s) => (s === undefined ? undefined : Array.isArray(s) ? s : [s])),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

@ApiTags('Aufträge')
@ApiBearerAuth()
@Controller('v1/orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get()
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager)
  @ZodQuery(listQuery)
  list(@Scope() scope: AccessScope, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.orders.list(scope, q);
  }

  @Get(':id')
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager)
  get(@Scope() scope: AccessScope, @Param('id', new ZodPipe(uuidParam)) id: string) {
    return this.orders.get(scope, id);
  }
}
