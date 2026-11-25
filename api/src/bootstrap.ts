import 'reflect-metadata';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { createHash } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config.js';

export async function createApp(
  config: AppConfig,
  opts: { logger?: boolean } = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
  });
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  // Simple parser: no nested objects from the query string (no endpoint needs them; avoids type confusion).
  app.set('query parser', 'simple');

  // Only traffic through Azure Front Door (WAF) – direct calls to the container ingress are refused.
  if (config.FRONT_DOOR_ID)
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/health/') || req.headers['x-azure-fdid'] === config.FRONT_DOOR_ID)
        return next();
      res.status(403).json({ statusCode: 403, message: 'Zugriff nur über das Gateway' });
    });

  // Security headers for a JSON API (ASVS 14.4): no framing, no sniffing, HSTS, CSP that allows nothing.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: { maxAge: 63_072_000, includeSubDomains: true },
    }),
  );
  // Personal data must not end up in browser or proxy caches (ASVS 8.2.1).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Rate limits (ASVS 11.1.4): per signed-in user (hashed bearer token), anonymous requests per IP.
  if (config.RATE_LIMIT_PER_MIN > 0) {
    const tokenKey = (req: Request) => {
      const auth = req.headers.authorization;
      return auth ? `t:${createHash('sha256').update(auth).digest('base64url').slice(0, 22)}` : null;
    };
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: (req: Request) =>
          tokenKey(req) ? config.RATE_LIMIT_PER_MIN : Math.max(10, config.RATE_LIMIT_PER_MIN / 4),
        keyGenerator: (req: Request) => tokenKey(req) ?? `ip:${req.ip}`,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: (req: Request) => req.path.startsWith('/health/'),
        message: { statusCode: 429, message: 'Zu viele Anfragen – bitte kurz warten.' },
      }),
    );
    // Speech is billed per request (Azure Speech).
    app.use(
      '/v1/speech',
      rateLimit({
        windowMs: 60_000,
        limit: 20,
        keyGenerator: (req: Request) => tokenKey(req) ?? `ip:${req.ip}`,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
      }),
    );
  }

  // Raw bodies for the local blob protocol (block uploads) and speech; speech is only buffered for requests with a
  // bearer token – anonymous requests are not read (ASVS 13.1).
  // Local blob storage exists only in dev/test (prod uploads go to Azure directly); one block = 1 MB.
  app.use('/v1/blob', express.raw({ type: () => true, limit: '1100kb' }));
  app.use('/v1/speech/transcribe', (req: Request, res: Response, next: NextFunction) =>
    req.headers.authorization
      ? next()
      : res.status(401).json({ statusCode: 401, message: 'Nicht angemeldet' }),
  );
  app.use('/v1/speech/transcribe', express.raw({ type: () => true, limit: '5mb' }));
  app.use('/v1/parts/cart-from-image', express.raw({ type: () => true, limit: '6mb' }));
  // OCI hand-back from the manufacturer catalogs (E-80): flat keys like NEW_ITEM-VENDORMAT[1], no nested parse.
  app.use('/v1/parts/catalog-return', express.urlencoded({ extended: false, limit: '1mb' }));
  app.enableCors({ origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: false });
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApi(app: NestExpressApplication): OpenAPIObject {
  const doc = new DocumentBuilder()
    .setTitle('Schröder Monteur-App API')
    .setDescription('REST-API der Monteur-App. Authentifizierung: Microsoft Entra ID (Bearer).')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, doc);
}
