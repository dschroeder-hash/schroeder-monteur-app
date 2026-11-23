import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { parseShopCartText, ROLES } from '@schroeder/shared';
import type { AccessScope } from '../../auth/auth.types.js';
import { Public, Roles, Scope } from '../../auth/decorators.js';
import { ZodBody, ZodPipe } from '../../common/zod.js';
import { DB } from '../../db/db.module.js';
import { withSession, type Db } from '../../db/client.js';
import { shopCartInbox, shopCartLink } from '../../db/schema.js';

const NO_USER = '00000000-0000-0000-0000-000000000000';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const pushBody = z.object({
  token: z.string().min(20).max(100),
  /** Visible text of the shop's cart page (the bookmark sends document.body.innerText). */
  text: z.string().min(1).max(60_000),
});

/**
 * Bookmark "→ Werkstatt-App" (E-78): the Monteur taps it on the shop's cart page; it sends the page text with a
 * personal link token to the app, which keeps the recognised lines until the Monteur's app picks them up – on any
 * device, without clipboard, screenshot or button.
 */
@ApiTags('Material')
@ApiBearerAuth()
@Controller('v1')
export class ShopCartController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** New personal link (replaces the old one – an old bookmark stops working). The token is shown only now. */
  @Put('me/shop-cart-link')
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager)
  async link(@Scope() s: AccessScope) {
    const token = randomBytes(24).toString('base64url');
    await withSession(this.db, { userId: s.userId, roles: s.roles }, (tx) =>
      tx
        .insert(shopCartLink)
        .values({ userId: s.userId, tokenHash: hash(token) })
        .onConflictDoUpdate({
          target: shopCartLink.userId,
          set: { tokenHash: hash(token), updatedAt: new Date() },
        }),
    );
    return { token };
  }

  /** Called by the app page /warenkorb-senden that the bookmark opens (no sign-in there – the token identifies). */
  @Post('parts/shop-cart')
  @Public()
  @HttpCode(200)
  @ZodBody(pushBody)
  async push(@Body(new ZodPipe(pushBody)) b: z.infer<typeof pushBody>) {
    const [link] = await withSession(this.db, { userId: NO_USER, roles: ['ShopCart.Push'] }, (tx) =>
      tx
        .select({ userId: shopCartLink.userId })
        .from(shopCartLink)
        .where(eq(shopCartLink.tokenHash, hash(b.token))),
    );
    if (!link) throw new BadRequestException('Lesezeichen ungültig – bitte in der App neu einrichten');
    const lines = parseShopCartText(b.text).slice(0, 100);
    if (lines.length)
      await withSession(this.db, { userId: link.userId, roles: [] }, async (tx) => {
        await tx.delete(shopCartInbox).where(lt(shopCartInbox.createdAt, new Date(Date.now() - 86_400_000)));
        await tx.insert(shopCartInbox).values({ userId: link.userId, lines });
      });
    return { lines: lines.length };
  }

  /** Picks up the carts sent by the bookmark (oldest first) – they are removed on pick-up. */
  @Get('parts/shop-cart/inbox')
  @Roles(ROLES.Monteur, ROLES.Meister, ROLES.Lager)
  async inbox(@Scope() s: AccessScope) {
    return withSession(this.db, { userId: s.userId, roles: s.roles }, async (tx) => {
      const rows = await tx
        .delete(shopCartInbox)
        .where(eq(shopCartInbox.userId, s.userId))
        .returning({ lines: shopCartInbox.lines, createdAt: shopCartInbox.createdAt });
      rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return { carts: rows.map((r) => r.lines) };
    });
  }
}
