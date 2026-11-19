import 'reflect-metadata';
import express from 'express';
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
  // Raw bodies for the local blob protocol (block uploads); must run before the JSON body parser.
  app.use('/v1/blob', express.raw({ type: () => true, limit: '8mb' }));
  app.use('/v1/speech/transcribe', express.raw({ type: () => true, limit: '5mb' }));
  app.set('query parser', 'extended');
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
