import { Controller, Get, Inject, NotFoundException, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../../config.js';

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Test dealer catalog for demo and automated tests (E-80): shows a small cart and hands it back as OCI form to the
 * HOOK_URL it was opened with – like the AGCO partsbook and agroparts do for the Schröder parts shop. 404 in prod.
 */
@ApiExcludeController()
@Controller('v1/dev')
export class DevPartsbookController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Public()
  @Get('partsbook')
  partsbook(@Query('HOOK_URL') hook: string | undefined, @Res() res: Response) {
    if (this.config.AUTH_MODE !== 'dev' || this.config.APP_ENV === 'prod') throw new NotFoundException();
    const lines = [
      ['F931.200.020.010', '2', 'Motorölfilter Fendt Vario'],
      ['X548844266000', '1', 'O-Ring'],
    ] as const;
    const fields = lines
      .map(
        ([no, q, d], i) =>
          `<input type="hidden" name="NEW_ITEM-VENDORMAT[${i + 1}]" value="${esc(no)}">` +
          `<input type="hidden" name="NEW_ITEM-QUANTITY[${i + 1}]" value="${q}.000">` +
          `<input type="hidden" name="NEW_ITEM-DESCRIPTION[${i + 1}]" value="${esc(d)}">` +
          `<input type="hidden" name="NEW_ITEM-UNIT[${i + 1}]" value="ST">`,
      )
      .join('');
    res.removeHeader('X-Frame-Options');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action *; frame-ancestors 'self' https: http://localhost:*",
    );
    res.type('html').send(`<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Test-Teilekatalog</title></head>
<body style="font-family:system-ui,sans-serif;padding:1rem;background:#f6f7f6">
<h1 style="margin-top:0">Test-Teilekatalog (Händler)</h1>
<p>So sieht der Warenkorb im Herstellerkatalog aus. „Warenkorb übergeben“ schickt ihn an die Werkstatt-App.</p>
<table style="border-collapse:collapse;background:#fff">${lines
      .map(
        ([no, q, d]) =>
          `<tr><td style="padding:.5rem 1rem">${esc(d)}</td><td style="padding:.5rem 1rem">Teilenr. ${esc(no)}</td><td style="padding:.5rem 1rem">${q} Stück</td></tr>`,
      )
      .join('')}</table>
${
  hook
    ? `<form method="post" action="${esc(hook)}" style="margin-top:1rem">${fields}<input type="hidden" name="~OkCode" value="ADDI"><button type="submit" style="font-size:1.1rem;padding:.8rem 1.4rem;background:#067a50;color:#fff;border:0;border-radius:.6rem">Warenkorb übergeben</button></form>`
    : '<p>Ohne HOOK_URL keine Übergabe.</p>'
}
</body></html>`);
  }
}
