import { createHash, randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { catalogHasHandBack, catalogUrl, parseOciCart, ROLES } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Public, RequireFeature, Roles, Scope } from '../../auth/decorators.js';
import { ZodBody, ZodPipe } from '../../common/zod.js';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db } from '../../db/client.js';
import { catalogSession, shopCartInbox } from '../../db/schema.js';
import { MaterialService } from './material.service.js';
import { catalogsFor } from './catalogs.js';

const NO_USER = '00000000-0000-0000-0000-000000000000';
const SESSION_HOURS = 8;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const sessionBody = z.object({ catalogId: z.string().min(1).max(40), orderId: z.string().uuid().nullable() });

/**
 * Manufacturer catalogs with cart hand-back (E-80), like the Schröder parts shop: the app opens the dealer catalog
 * with a personal return address (OCI HOOK_URL); the catalog posts the finished cart there; the Monteur's app picks
 * it up – the tractor flies, the lines are in the order. The app never reads catalog pages.
 */
@ApiTags('Material')
@ApiBearerAuth()
@Controller('v1/parts')
export class CatalogController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MaterialService) private readonly material: MaterialService,
  ) {}

  /** Opens a catalog for an order: address with return address (if the catalog has a hand-back). */
  @Post('catalog-sessions')
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager)
  @RequireFeature('materials')
  @ZodBody(sessionBody)
  async open(
    @Scope() s: AccessScope,
    @Body(new ZodPipe(sessionBody)) b: z.infer<typeof sessionBody>,
    @Req() req: Request,
  ) {
    const catalogs = await catalogsFor(this.db, this.material, this.config, s);
    const c = catalogs.find((x) => x.id === b.catalogId);
    if (!c) throw new NotFoundException('Katalog nicht eingerichtet');
    if (!catalogHasHandBack(c)) return { url: catalogUrl(c, null), mode: c.mode, handBack: false };
    const token = randomBytes(24).toString('base64url');
    await withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      await tx
        .delete(catalogSession)
        .where(and(eq(catalogSession.userId, s.userId), lt(catalogSession.expiresAt, new Date())));
      await tx.insert(catalogSession).values({
        userId: s.userId,
        orderId: b.orderId,
        catalogId: c.id,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
      });
    });
    // Demo behind a forwarding proxy (Codespaces): the app's own address, which proxies /v1 to the API.
    const origin = this.config.APP_ENV === 'dev' ? req.headers.origin : undefined;
    const base = (
      typeof origin === 'string' && /^https?:\/\//.test(origin) ? origin : this.config.PUBLIC_API_URL
    ).replace(/\/$/, '');
    const hook = `${base}/v1/parts/catalog-return/${token}`;
    return { url: catalogUrl(c, hook), mode: c.mode, handBack: true };
  }

  /**
   * Return address the catalog posts the cart to (OCI form, also as GET). No sign-in – the session secret in the
   * address identifies Monteur and order. Answers with a small page that tells the app and closes/returns.
   */
  @Post('catalog-return/:token')
  @Public()
  @HttpCode(200)
  async handBackPost(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const fields = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    await this.handBack(token, fields, res);
  }

  @Get('catalog-return/:token')
  @Public()
  async handBackGet(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    // Raw query (not the nested qs parse): OCI keys look like NEW_ITEM-VENDORMAT[1].
    const q = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
    await this.handBack(token, Object.fromEntries(q.entries()), res);
  }

  private async handBack(token: string, fields: Record<string, unknown>, res: Response) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return this.page(res, 400, 'Rücksprung-Adresse ungültig.');
    const [session] = await withSession(this.db, { userId: NO_USER, roles: ['Catalog.Return'] }, (tx) =>
      tx
        .select()
        .from(catalogSession)
        .where(and(eq(catalogSession.tokenHash, hash(token)), gt(catalogSession.expiresAt, new Date()))),
    );
    if (!session)
      return this.page(
        res,
        400,
        'Diese Katalog-Sitzung ist abgelaufen. Bitte den Katalog in der App neu öffnen.',
      );
    const lines = parseOciCart(fields);
    if (!lines.length) return this.page(res, 200, 'Der Warenkorb war leer – es wurde nichts übernommen.', 0);
    await withSession(this.db, { userId: session.userId, roles: [] }, async (tx) => {
      await tx.delete(shopCartInbox).where(lt(shopCartInbox.createdAt, new Date(Date.now() - 86_400_000)));
      await tx
        .insert(shopCartInbox)
        .values({ userId: session.userId, orderId: session.orderId, catalogId: session.catalogId, lines });
    });
    return this.page(
      res,
      200,
      `${lines.length} ${lines.length === 1 ? 'Position' : 'Positionen'} an die Werkstatt-App übergeben.`,
      lines.length,
    );
  }

  /** Small answer page: tells the app (window that opened it, or the page around the frame) and goes back. */
  private page(res: Response, status: number, text: string, lines?: number) {
    const nonce = randomBytes(16).toString('base64');
    const message = JSON.stringify({ type: 'werkstatt-catalog-cart', lines: lines ?? null });
    res.removeHeader('X-Frame-Options');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-ancestors 'self' https: http://localhost:*`,
    );
    res.status(status).type('html').send(`<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Werkstatt-App</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center;padding:1rem">
<div><p style="font-size:1.4rem;font-weight:700">${lines ? '✓ ' : ''}${escapeHtml(text)}</p>
<p>Sie können zur Werkstatt-App zurückkehren.</p></div>
<script nonce="${nonce}">(function(){var m=${message};try{
if(window.opener&&!window.opener.closed){window.opener.postMessage(m,'*');setTimeout(function(){window.close()},1500);}
else if(window.top!==window){window.top.postMessage(m,'*');}
else if(history.length>1){setTimeout(function(){history.back()},1500);}
}catch(e){}})();</script></body></html>`);
  }

  /** Carts handed back by the catalogs (oldest first) – removed on pick-up. */
  @Get('shop-cart/inbox')
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager)
  async inbox(@Scope() s: AccessScope, @Query('orderId') orderId?: string) {
    // With orderId: only that order's carts (and those opened without order) – others wait for their order.
    const forOrder =
      orderId && /^[0-9a-f-]{36}$/i.test(orderId)
        ? or(eq(shopCartInbox.orderId, orderId), isNull(shopCartInbox.orderId))
        : undefined;
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const rows = await tx
        .delete(shopCartInbox)
        .where(and(eq(shopCartInbox.userId, s.userId), forOrder))
        .returning({
          orderId: shopCartInbox.orderId,
          catalogId: shopCartInbox.catalogId,
          lines: shopCartInbox.lines,
          createdAt: shopCartInbox.createdAt,
        });
      rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return { carts: rows.map(({ createdAt: _c, ...r }) => r) };
    });
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
