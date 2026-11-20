import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { ROLES } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Public, RequireFeature, Roles, Scope } from '../../auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { uuidParam, ZodBody, ZodPipe } from '../../common/zod.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db } from '../../db/client.js';
import {
  appUser,
  chatMessage,
  notification,
  photo,
  pushSubscription,
  serviceOrder,
  textTemplate,
  workReport,
} from '../../db/schema.js';
import { FeatureService } from '../../features/feature.service.js';
import { BLOB_STORAGE } from './files.tokens.js';
import { isJpeg, MAX_PHOTO_BYTES, type BlobStorage } from './blob-storage.js';
import { CommService } from './comm.service.js';
import { REALTIME, type Realtime } from './realtime.js';
import { SPEECH, TEXT_REWRITE, type SpeechToText, type TextRewrite } from './speech.js';

const sess = (s: AccessScope) => ({ userId: s.userId, roles: s.roles });
const ORDER_ROLES = [ROLES.Monteur, ROLES.Meister, ROLES.Lager] as const;

/** Photos (PROMPT 5.7): resumable upload to private storage via short-lived URLs. */
@ApiTags('Fotos')
@ApiBearerAuth()
@Roles(...ORDER_ROLES)
@RequireFeature('photos')
@Controller('v1')
export class PhotosController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(BLOB_STORAGE) private readonly storage: BlobStorage,
  ) {}

  /** Upload URL for the photo's blob – only the uploader, only while not uploaded. */
  @Post('photos/:id/upload-target')
  @HttpCode(200)
  async uploadTarget(@Scope() s: AccessScope, @Param('id', new ZodPipe(uuidParam)) id: string) {
    const p = await withSession(
      this.db,
      sess(s),
      async (tx) => (await tx.select().from(photo).where(eq(photo.id, id)))[0],
    );
    if (!p || p.uploadedBy !== s.userId) throw new NotFoundException('Foto nicht gefunden');
    if (p.uploadState === 'UPLOADED') return { url: null, uploaded: true };
    return { url: await this.storage.uploadUrl(p.blobPath), uploaded: false };
  }

  /** Called after "Put Block List": verifies the blob and marks the photo as uploaded. */
  @Post('photos/:id/complete')
  @HttpCode(200)
  async complete(@Scope() s: AccessScope, @Param('id', new ZodPipe(uuidParam)) id: string) {
    return withSession(this.db, sess(s), async (tx) => {
      const [p] = await tx.select().from(photo).where(eq(photo.id, id));
      if (!p || p.uploadedBy !== s.userId) throw new NotFoundException('Foto nicht gefunden');
      const size = await this.storage.size(p.blobPath);
      if (size === null || size === 0) throw new BadRequestException('Upload unvollständig');
      // The client only reports metadata – size and file type are checked on the stored blob (ASVS 12.1/12.2).
      if (size > MAX_PHOTO_BYTES || !isJpeg(await this.storage.head(p.blobPath, 3))) {
        await this.storage.delete(p.blobPath);
        throw new BadRequestException('Datei ist kein gültiges Foto (JPEG, max. 25 MB)');
      }
      await tx
        .update(photo)
        .set({ uploadState: 'UPLOADED', uploadedAt: new Date(), sizeBytes: size })
        .where(eq(photo.id, id));
      return { ok: true, sizeBytes: size };
    });
  }

  @Get('orders/:id/photos')
  async list(@Scope() s: AccessScope, @Param('id', new ZodPipe(uuidParam)) orderId: string) {
    return withSession(this.db, sess(s), async (tx) => {
      const [o] = await tx
        .select({ id: serviceOrder.id })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId));
      if (!o) throw new NotFoundException('Auftrag nicht gefunden');
      const rows = await tx
        .select()
        .from(photo)
        .where(and(eq(photo.orderId, orderId), isNull(photo.deletedAt), eq(photo.uploadState, 'UPLOADED')))
        .orderBy(asc(photo.capturedAt));
      return Promise.all(rows.map(async (p) => ({ ...p, url: await this.storage.readUrl(p.blobPath) })));
    });
  }

  @Get('photos/:id/url')
  async url(@Scope() s: AccessScope, @Param('id', new ZodPipe(uuidParam)) id: string) {
    const p = await withSession(
      this.db,
      sess(s),
      async (tx) =>
        (
          await tx
            .select()
            .from(photo)
            .where(and(eq(photo.id, id), isNull(photo.deletedAt)))
        )[0],
    );
    if (!p || p.uploadState !== 'UPLOADED') throw new NotFoundException('Foto nicht gefunden');
    return { url: await this.storage.readUrl(p.blobPath) };
  }
}

const chatBody = z
  .object({
    id: z.string().uuid().optional(),
    body: z.string().max(4000).default(''),
    photoId: z.string().uuid().nullish(),
  })
  .refine((v) => v.body.trim().length > 0 || !!v.photoId, { message: 'Nachricht ist leer' });
const readBody = z.object({ upToServerSeq: z.number().int().nonnegative() });

/** Order chat for online clients (Meister; Monteure use the offline sync). PROMPT 5.8. */
@ApiTags('Chat')
@ApiBearerAuth()
@Roles(...ORDER_ROLES)
@RequireFeature('chat')
@Controller('v1/orders/:id/chat')
export class ChatController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CommService) private readonly comm: CommService,
  ) {}

  @Get()
  async list(@Scope() s: AccessScope, @Param('id', new ZodPipe(uuidParam)) orderId: string) {
    return withSession(this.db, sess(s), async (tx) => {
      const [o] = await tx
        .select({ id: serviceOrder.id, bcNo: serviceOrder.bcNo, customerName: serviceOrder.customerName })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId));
      if (!o) throw new NotFoundException('Auftrag nicht gefunden');
      const messages = await tx
        .select({ m: chatMessage, authorName: appUser.displayName })
        .from(chatMessage)
        .leftJoin(appUser, eq(appUser.id, chatMessage.authorId))
        .where(and(eq(chatMessage.orderId, orderId), isNull(chatMessage.deletedAt)))
        .orderBy(asc(chatMessage.serverSeq))
        .limit(1000);
      const reads = await this.comm.readsFor(
        tx,
        messages.map((x) => x.m.id),
      );
      return {
        order: o,
        messages: messages.map((x) => ({
          ...x.m,
          authorName: x.authorName,
          readBy: reads.filter((r) => r.messageId === x.m.id).map((r) => r.userId),
        })),
      };
    });
  }

  @Post()
  @ZodBody(chatBody)
  async send(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) orderId: string,
    @Body(new ZodPipe(chatBody)) b: z.infer<typeof chatBody>,
  ) {
    return withSession(this.db, sess(s), async (tx) => {
      const [o] = await tx
        .select({ id: serviceOrder.id })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId));
      if (!o) throw new NotFoundException('Auftrag nicht gefunden');
      return this.comm.sendMessage(
        tx,
        s,
        b.id ?? crypto.randomUUID(),
        null,
        new Date(),
        { orderId, body: b.body, photoId: b.photoId },
        null,
      );
    });
  }

  @Post('read')
  @HttpCode(200)
  @ZodBody(readBody)
  async read(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) orderId: string,
    @Body(new ZodPipe(readBody)) b: z.infer<typeof readBody>,
  ) {
    return withSession(this.db, sess(s), async (tx) => {
      const [o] = await tx
        .select({ id: serviceOrder.id })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId));
      if (!o) throw new NotFoundException('Auftrag nicht gefunden');
      await this.comm.markRead(tx, s, orderId, b.upToServerSeq);
      return { ok: true };
    });
  }
}

const subscriptionBody = z.object({
  endpoint: z.string().url().startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});
const readNotifications = z.object({
  ids: z.array(z.string().uuid()).max(200).optional(),
  all: z.boolean().optional(),
});

/** In-app notifications and Web Push subscriptions (own only). */
@ApiTags('Benachrichtigungen')
@ApiBearerAuth()
@Controller('v1')
export class NotificationsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REALTIME) private readonly realtime: Realtime,
  ) {}

  @Get('notifications')
  list(@Scope() s: AccessScope) {
    return withSession(this.db, sess(s), (tx) =>
      tx
        .select()
        .from(notification)
        .where(eq(notification.userId, s.userId))
        .orderBy(desc(notification.createdAt))
        .limit(50),
    );
  }

  @Post('notifications/read')
  @HttpCode(200)
  @ZodBody(readNotifications)
  read(@Scope() s: AccessScope, @Body(new ZodPipe(readNotifications)) b: z.infer<typeof readNotifications>) {
    return withSession(this.db, sess(s), async (tx) => {
      await tx
        .update(notification)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notification.userId, s.userId),
            isNull(notification.readAt),
            b.all
              ? undefined
              : inArray(notification.id, b.ids?.length ? b.ids : ['00000000-0000-0000-0000-000000000000']),
          ),
        );
      return { ok: true };
    });
  }

  @Public()
  @Get('push/vapid-public-key')
  vapid() {
    return { publicKey: this.config.VAPID_PUBLIC_KEY ?? null };
  }

  @Post('push/subscriptions')
  @HttpCode(200)
  @ZodBody(subscriptionBody)
  subscribe(
    @Scope() s: AccessScope,
    @Body(new ZodPipe(subscriptionBody)) b: z.infer<typeof subscriptionBody>,
    @Req() req: Request,
  ) {
    return withSession(this.db, sess(s), async (tx) => {
      const values = {
        userId: s.userId,
        endpoint: b.endpoint,
        p256dh: b.keys.p256dh,
        auth: b.keys.auth,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      };
      // One row per user and browser. Rows of other users with the same endpoint (shared device) are removed by
      // the worker before delivery – the newest subscription wins (RLS forbids touching them here).
      await tx
        .insert(pushSubscription)
        .values(values)
        .onConflictDoUpdate({
          target: [pushSubscription.userId, pushSubscription.endpoint],
          set: {
            p256dh: values.p256dh,
            auth: values.auth,
            userAgent: values.userAgent,
            updatedAt: new Date(),
          },
        });
      return { ok: true };
    });
  }

  @Delete('push/subscriptions')
  @ZodBody(subscriptionBody.pick({ endpoint: true }))
  unsubscribe(
    @Scope() s: AccessScope,
    @Body(new ZodPipe(subscriptionBody.pick({ endpoint: true }))) b: { endpoint: string },
  ) {
    return withSession(this.db, sess(s), async (tx) => {
      await tx
        .delete(pushSubscription)
        .where(and(eq(pushSubscription.endpoint, b.endpoint), eq(pushSubscription.userId, s.userId)));
      return { ok: true };
    });
  }

  /** Web PubSub access URL limited to the user's own groups (null → client polls). */
  @Get('realtime/negotiate')
  async negotiate(@Scope() s: AccessScope) {
    const groups = [`user:${s.userId}`, ...s.meisterLocationIds.map((l) => `location:${l}:board`)];
    return { url: await this.realtime.clientUrl(s.userId, groups) };
  }
}

const transcribeQuery = z.object({});
const rewriteBody = z.object({ text: z.string().min(1).max(8000) });

/** Dictation fallback (Azure AI Speech) and optional AI rewrite (feature flag dictation.ai, OP-10). */
@ApiTags('Diktat')
@ApiBearerAuth()
@Roles(ROLES.Monteur, ROLES.Meister)
@RequireFeature('dictation')
@Controller('v1/speech')
export class SpeechController {
  constructor(
    @Inject(SPEECH) private readonly speech: SpeechToText,
    @Inject(TEXT_REWRITE) private readonly rewriter: TextRewrite,
    @Inject(FeatureService) private readonly features: FeatureService,
  ) {}

  @Post('transcribe')
  @HttpCode(200)
  async transcribe(@Req() req: Request) {
    void transcribeQuery;
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length === 0) throw new BadRequestException('Audio fehlt');
    if (audio.length > 4_000_000) throw new BadRequestException('Aufnahme zu lang (max. 60 Sekunden)');
    if (!this.speech.configured)
      throw new NotImplementedException('Diktat über den Server ist nicht eingerichtet');
    return { text: await this.speech.transcribe(audio, String(req.headers['content-type'] ?? 'audio/wav')) };
  }

  @Post('rewrite')
  @HttpCode(200)
  @ZodBody(rewriteBody)
  async rewrite(@Scope() s: AccessScope, @Body(new ZodPipe(rewriteBody)) b: z.infer<typeof rewriteBody>) {
    if (!(await this.features.isEnabledForAny('dictation.ai', s.locationIds)))
      throw new ForbiddenException('KI-Umformulierung ist nicht freigeschaltet');
    if (!this.rewriter.configured)
      throw new NotImplementedException('KI-Umformulierung ist nicht eingerichtet');
    return { text: await this.rewriter.rewrite(b.text) };
  }
}

const templateBody = z.object({
  locationId: z.string().uuid().nullable(),
  orderTypeCode: z.string().max(20).nullable().optional(),
  machineGroup: z.string().max(40).nullable().optional(),
  title: z.string().min(2).max(120),
  body: z.string().min(2).max(2000),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

/** Quick documentation templates – maintained by Meister (own location) and Admin (all/global). PROMPT 5.6. */
@ApiTags('Textbausteine')
@ApiBearerAuth()
@Roles(ROLES.Meister, ROLES.Admin)
@Controller('v1/templates')
export class TemplatesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  private allowed(s: AccessScope, locationId: string | null) {
    if (s.roles.includes(ROLES.Admin)) return true;
    return locationId !== null && s.meisterLocationIds.includes(locationId);
  }

  @Get()
  list(@Scope() s: AccessScope) {
    const where = s.roles.includes(ROLES.Admin)
      ? undefined
      : or(
          isNull(textTemplate.locationId),
          inArray(
            textTemplate.locationId,
            s.meisterLocationIds.length ? s.meisterLocationIds : ['00000000-0000-0000-0000-000000000000'],
          ),
        );
    return this.db
      .select()
      .from(textTemplate)
      .where(where)
      .orderBy(asc(textTemplate.sortOrder), asc(textTemplate.title));
  }

  @Post()
  @ZodBody(templateBody)
  async create(@Scope() s: AccessScope, @Body(new ZodPipe(templateBody)) b: z.infer<typeof templateBody>) {
    if (!this.allowed(s, b.locationId))
      throw new ForbiddenException('Nur für den eigenen Standort (globale Bausteine: Admin)');
    const [row] = await this.db
      .insert(textTemplate)
      .values({ ...b, orderTypeCode: b.orderTypeCode ?? null, machineGroup: b.machineGroup ?? null })
      .returning();
    return row;
  }

  @Patch(':id')
  @ZodBody(templateBody.partial())
  async update(
    @Scope() s: AccessScope,
    @Param('id', new ZodPipe(uuidParam)) id: string,
    @Body(new ZodPipe(templateBody.partial())) b: Partial<z.infer<typeof templateBody>>,
  ) {
    const [old] = await this.db.select().from(textTemplate).where(eq(textTemplate.id, id));
    if (
      !old ||
      !this.allowed(s, old.locationId) ||
      (b.locationId !== undefined && !this.allowed(s, b.locationId))
    )
      throw new NotFoundException('Baustein nicht gefunden');
    const [row] = await this.db.update(textTemplate).set(b).where(eq(textTemplate.id, id)).returning();
    return row;
  }
}

/** Work report of an order (read) – Meister review before approval; visibility via RLS. */
@ApiTags('Aufträge')
@ApiBearerAuth()
@Roles(...ORDER_ROLES)
@Controller('v1/orders/:id/report')
export class ReportController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async get(@Scope() s: AccessScope, @Param('id', new ZodPipe(uuidParam)) orderId: string) {
    return withSession(this.db, sess(s), async (tx) => {
      const [o] = await tx
        .select({ id: serviceOrder.id })
        .from(serviceOrder)
        .where(eq(serviceOrder.id, orderId));
      if (!o) throw new NotFoundException('Auftrag nicht gefunden');
      const [r] = await tx
        .select({ r: workReport, authorName: appUser.displayName })
        .from(workReport)
        .leftJoin(appUser, eq(appUser.id, workReport.authorId))
        .where(eq(workReport.orderId, orderId));
      return r ? { ...r.r, authorName: r.authorName } : null;
    });
  }
}
