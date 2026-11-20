import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../auth/decorators.js';
import { BLOB_STORAGE } from './files.tokens.js';
import { LocalBlobStorage, type BlobStorage } from './blob-storage.js';

/**
 * Local implementation of the Azure Blob block protocol (dev/test only). Authorised solely by the signed,
 * short-lived token in the URL – exactly like a SAS. Not mounted when Azure storage is configured.
 */
@ApiExcludeController()
@Controller('v1/blob')
export class LocalBlobController {
  constructor(@Inject(BLOB_STORAGE) private readonly storage: BlobStorage) {}

  private local(): LocalBlobStorage {
    if (!(this.storage instanceof LocalBlobStorage)) throw new NotFoundException();
    return this.storage;
  }

  @Public()
  @Put(':token')
  @HttpCode(201)
  async put(
    @Param('token') token: string,
    @Query('comp') comp: string,
    @Query('blockid') blockId: string,
    @Req() req: Request,
  ) {
    const s = this.local();
    const path = s.verify(token, 'w');
    if (!path) throw new ForbiddenException('Upload-Link ungültig oder abgelaufen');
    const body = req.body as Buffer;
    if (comp === 'block') {
      if (!Buffer.isBuffer(body) || !blockId) throw new BadRequestException('Block fehlt');
      await s.putBlock(path, blockId, body);
      return;
    }
    if (comp === 'blocklist') {
      const ids = [...String(body).matchAll(/<(?:Latest|Uncommitted|Committed)>([^<]+)<\//g)].map(
        (m) => m[1]!,
      );
      if (!ids.length) throw new BadRequestException('Blockliste leer');
      await s.commit(path, ids);
      return;
    }
    throw new BadRequestException('comp=block oder comp=blocklist erwartet');
  }

  @Public()
  @Get(':token')
  async get(@Param('token') token: string, @Query('comp') comp: string, @Res() res: Response) {
    const s = this.local();
    if (comp === 'blocklist') {
      const path = s.verify(token, 'w');
      if (!path) throw new ForbiddenException('Upload-Link ungültig oder abgelaufen');
      const blocks = await s.uncommittedBlocks(path);
      res
        .type('application/xml')
        .send(
          `<?xml version="1.0" encoding="utf-8"?><BlockList><CommittedBlocks/><UncommittedBlocks>${blocks
            .map((b) => `<Block><Name>${b.id}</Name><Size>${b.size}</Size></Block>`)
            .join('')}</UncommittedBlocks></BlockList>`,
        );
      return;
    }
    const path = s.verify(token, 'r');
    if (!path) throw new ForbiddenException('Link ungültig oder abgelaufen');
    try {
      res
        .type('image/jpeg')
        .setHeader('Cache-Control', 'private, max-age=600')
        .send(await s.read(path));
    } catch {
      throw new NotFoundException();
    }
  }
}
