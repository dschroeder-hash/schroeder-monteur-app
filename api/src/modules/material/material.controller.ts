import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  agcoDeeplinkAdapter,
  availableQuantity,
  belowMinimum,
  extractPartNo,
  ROLES,
} from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { RequireFeature, Roles, Scope } from '../../auth/decorators.js';
import { AuditService } from '../../common/audit.service.js';
import { uuidParam, ZodBody, ZodPipe, ZodQuery } from '../../common/zod.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db } from '../../db/client.js';
import {
  appUser,
  container,
  item,
  itemStock,
  partRequest,
  serviceOrder,
  storageLocation,
} from '../../db/schema.js';
import { notify } from '../notifications.js';
import { FeatureService } from '../../features/feature.service.js';
import { MaterialService } from './material.service.js';
import {
  CART_IMAGE_TYPES,
  CART_READER,
  CartReadError,
  type CartImageType,
  type CartReader,
} from './cart-reader.js';

const searchQuery = z.object({ q: z.string().max(80).optional(), code: z.string().max(80).optional() });
const resolveQuery = z.object({ text: z.string().min(1).max(500) });
const locQuery = z.object({ locationId: z.string().uuid() });
const stateBody = z.object({
  state: z.enum(['BESTELLT', 'GELIEFERT', 'STORNIERT']),
  note: z.string().max(300).optional(),
});
const containerBody = z.object({
  locationId: z.string().uuid(),
  storageLocationId: z.string().uuid(),
  itemId: z.string().uuid(),
  kind: z.enum(['FASS', 'IBC', 'TANK', 'KANISTER', 'KARTUSCHE']),
  name: z.string().min(2).max(80),
  capacity: z.number().positive().nullable().optional(),
  minStock: z.number().nonnegative().nullable().optional(),
  hasMeter: z.boolean().default(false),
  quickQuantities: z.array(z.number().positive()).max(6).default([5, 10, 20, 40]),
  active: z.boolean().default(true),
});

/** Parts search and catalog links for Monteur, Meister and Lager (PROMPT 5.5). */
@ApiTags('Material')
@ApiBearerAuth()
@Controller('v1')
export class MaterialController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MaterialService) private readonly material: MaterialService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CART_READER) private readonly cartReader: CartReader,
    @Inject(FeatureService) private readonly features: FeatureService,
  ) {}

  private sess(s: AccessScope) {
    return { userId: s.userId, roles: s.roles };
  }

  /**
   * "Warenkorb übertragen" (E-76): screenshot of the manufacturer cart → part numbers and quantities, each resolved
   * against the BC item master. The image is not stored; it goes to the AI provider only for this one request.
   */
  @Post('parts/cart-from-image')
  @HttpCode(200)
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager)
  @RequireFeature('materials')
  async cartFromImage(@Scope() s: AccessScope, @Req() req: Request) {
    if (!(await this.features.isEnabledForAny('parts.cartAi', s.locationIds)))
      throw new ForbiddenException('Warenkorb-Übernahme per KI ist nicht freigeschaltet');
    if (!this.cartReader.configured)
      throw new NotImplementedException('Warenkorb-Übernahme per KI ist nicht eingerichtet');
    const image = req.body as Buffer;
    const type = String(req.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim();
    if (!Buffer.isBuffer(image) || image.length === 0) throw new BadRequestException('Bild fehlt');
    if (!(CART_IMAGE_TYPES as readonly string[]).includes(type))
      throw new BadRequestException('Bitte ein Bild (PNG oder JPEG) senden');
    let lines;
    try {
      lines = await this.cartReader.read(image, type as CartImageType);
    } catch (e) {
      if (e instanceof CartReadError) throw new BadRequestException(e.message);
      throw new ServiceUnavailableException(
        'Die KI ist gerade nicht erreichbar – bitte später erneut versuchen',
      );
    }
    const resolved = await withSession(this.db, this.sess(s), async (tx) =>
      Promise.all(
        lines.map(async (l) => {
          const items = await this.material.search(tx, s.locationIds, { code: l.partNo }, 1);
          return { ...l, item: items[0] ?? null };
        }),
      ),
    );
    return { lines: resolved };
  }

  @Get('items/search')
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager, ROLES.Terminal)
  @RequireFeature('materials')
  @ZodQuery(searchQuery)
  search(@Scope() s: AccessScope, @Query(new ZodPipe(searchQuery)) q: z.infer<typeof searchQuery>) {
    if (!q.q && !q.code) throw new BadRequestException('Suchbegriff oder Code angeben');
    return withSession(this.db, this.sess(s), (tx) =>
      this.material.search(tx, s.locationIds, { text: q.q, code: q.code }),
    );
  }

  /** Resolves a part number copied from the manufacturer catalog (clipboard/scan) against the BC item master. */
  @Get('items/resolve')
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager)
  @RequireFeature('materials')
  @ZodQuery(resolveQuery)
  async resolve(@Scope() s: AccessScope, @Query(new ZodPipe(resolveQuery)) q: z.infer<typeof resolveQuery>) {
    const partNo = extractPartNo(q.text);
    if (!partNo) return { partNo: null, items: [] };
    const items = await withSession(this.db, this.sess(s), (tx) =>
      this.material.search(tx, s.locationIds, { code: partNo }, 5),
    );
    return { partNo, items };
  }

  /** Configured manufacturer catalogs – deep links only (no data is fetched from the catalog). */
  @Get('parts/catalogs')
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager)
  async catalogs(@Scope() s: AccessScope) {
    const cfg = await withSession(this.db, this.sess(s), (tx) =>
      this.material.setting<{ agcoTemplate?: string; agcoEmbed?: boolean }>(
        tx,
        s.locationIds[0] ?? '00000000-0000-0000-0000-000000000000',
        'partsCatalogs',
        {},
      ),
    );
    const agco = agcoDeeplinkAdapter(cfg.agcoTemplate);
    return [
      {
        id: agco.id,
        label: agco.label,
        brands: agco.brands,
        template: cfg.agcoTemplate ?? null,
        // Catalog shown inside the parts page (E-74); switch off with partsCatalogs.agcoEmbed = false.
        embed: cfg.agcoEmbed !== false,
      },
    ];
  }

  @Get('parts/requests')
  @Roles(ROLES.Lager, ROLES.Meister)
  @ZodQuery(locQuery)
  async requests(@Scope() s: AccessScope, @Query(new ZodPipe(locQuery)) q: z.infer<typeof locQuery>) {
    if (![...s.lagerLocationIds, ...s.meisterLocationIds].includes(q.locationId))
      throw new ForbiddenException('Keine Berechtigung für diesen Standort');
    return withSession(this.db, this.sess(s), async (tx) => {
      const rows = await tx
        .select({
          r: partRequest,
          item,
          bcNo: serviceOrder.bcNo,
          customerName: serviceOrder.customerName,
          requestedByName: appUser.displayName,
        })
        .from(partRequest)
        .leftJoin(item, eq(item.id, partRequest.itemId))
        .innerJoin(serviceOrder, eq(serviceOrder.id, partRequest.orderId))
        .innerJoin(appUser, eq(appUser.id, partRequest.requestedBy))
        .where(
          and(eq(partRequest.locationId, q.locationId), inArray(partRequest.state, ['OFFEN', 'BESTELLT'])),
        )
        .orderBy(asc(partRequest.expectedDelivery), desc(partRequest.createdAt));
      return rows.map((r) => ({
        ...r.r,
        item: r.item,
        bcNo: r.bcNo,
        customerName: r.customerName,
        requestedByName: r.requestedByName,
      }));
    });
  }

  @Post('parts/requests/:id/state')
  @HttpCode(200)
  @Roles(ROLES.Lager, ROLES.Meister)
  @ZodBody(stateBody)
  async setRequestState(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(stateBody)) b: z.infer<typeof stateBody>,
  ) {
    return withSession(this.db, this.sess(s), async (tx) => {
      const [r] = await tx.select().from(partRequest).where(eq(partRequest.id, id));
      if (!r || ![...s.lagerLocationIds, ...s.meisterLocationIds].includes(r.locationId))
        throw new NotFoundException('Anforderung nicht gefunden');
      await tx.update(partRequest).set({ state: b.state }).where(eq(partRequest.id, id));
      const [o] = await tx
        .select({ bcNo: serviceOrder.bcNo })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, r.orderId));
      const text =
        b.state === 'GELIEFERT'
          ? 'ist eingetroffen'
          : b.state === 'BESTELLT'
            ? 'wurde bestellt'
            : 'wurde storniert';
      await notify(
        tx,
        r.requestedBy,
        'PART_REQUEST',
        `Teil für ${o?.bcNo ?? 'Auftrag'} ${text}`,
        b.note ?? '',
        `/monteur/auftrag?id=${r.orderId}`,
      );
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'PART_REQUEST_STATE',
        entity: 'part_request',
        entityId: id,
        oldValue: { state: r.state },
        newValue: b,
      });
      return { ok: true };
    });
  }

  /** Stock below minimum for the location (warning list for Meister and Lager). */
  @Get('stock/warnings')
  @Roles(ROLES.Lager, ROLES.Meister)
  @ZodQuery(locQuery)
  async warnings(@Scope() s: AccessScope, @Query(new ZodPipe(locQuery)) q: z.infer<typeof locQuery>) {
    if (![...s.lagerLocationIds, ...s.meisterLocationIds].includes(q.locationId))
      throw new ForbiddenException('Keine Berechtigung für diesen Standort');
    return withSession(this.db, this.sess(s), async (tx) => {
      const rows = await tx
        .select({ s: itemStock, item, storage: storageLocation, cont: container })
        .from(itemStock)
        .innerJoin(item, eq(item.id, itemStock.itemId))
        .innerJoin(storageLocation, eq(storageLocation.id, itemStock.storageLocationId))
        .leftJoin(
          container,
          and(
            eq(container.itemId, itemStock.itemId),
            eq(container.storageLocationId, itemStock.storageLocationId),
          ),
        )
        .where(eq(storageLocation.locationId, q.locationId));
      return rows
        .map((r) => ({
          itemId: r.item.id,
          itemNumber: r.item.number,
          name: r.cont?.name ?? r.item.name,
          unit: r.item.unit,
          storage: r.storage.name,
          available: availableQuantity(r.s.bcInventory, r.s.pendingWithdrawal),
          minStock: r.cont?.minStock ?? r.s.minStock,
        }))
        .filter((r) => belowMinimum(r.available, r.minStock));
    });
  }
}

/** Containers and tanks (Gebinde/Tankanlagen) – app master data (PROMPT 4, Admin). */
@ApiTags('Administration')
@ApiBearerAuth()
@Roles(ROLES.Admin)
@Controller('v1/admin/containers')
export class ContainersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.db.select().from(container).orderBy(asc(container.name));
  }

  @Post()
  @ZodBody(containerBody)
  async create(@Scope() s: AccessScope, @Body(new ZodPipe(containerBody)) b: z.infer<typeof containerBody>) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [st] = await tx.select().from(storageLocation).where(eq(storageLocation.id, b.storageLocationId));
      if (!st || st.locationId !== b.locationId)
        throw new BadRequestException('Lagerort gehört nicht zum Standort');
      const [row] = await tx.insert(container).values(b).returning();
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'CREATE',
        entity: 'container',
        entityId: row!.id,
        newValue: row,
      });
      return row;
    });
  }

  @Patch(':id')
  @ZodBody(containerBody.partial())
  async update(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(containerBody.partial())) b: Partial<z.infer<typeof containerBody>>,
  ) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const [old] = await tx.select().from(container).where(eq(container.id, id));
      if (!old) throw new NotFoundException('Gebinde nicht gefunden');
      const [row] = await tx.update(container).set(b).where(eq(container.id, id)).returning();
      await this.audit.log(tx, {
        actorId: s.userId,
        action: 'UPDATE',
        entity: 'container',
        entityId: id,
        oldValue: old,
        newValue: row,
      });
      return row;
    });
  }
}
