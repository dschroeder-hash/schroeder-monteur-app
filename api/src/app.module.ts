import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard.js';
import { DevAuthController } from './auth/dev-auth.controller.js';
import { ScopeService } from './auth/scope.service.js';
import { TokenVerifier } from './auth/token-verifier.js';
import { AuditService } from './common/audit.service.js';
import { HttpErrorFilter } from './common/http-exception.filter.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { DbModule } from './db/db.module.js';
import { FeatureService } from './features/feature.service.js';
import { AdminController } from './modules/admin/admin.controller.js';
import { TransfersController } from './modules/admin/transfers.controller.js';
import { HealthController } from './modules/health.controller.js';
import { MeController } from './modules/me/me.controller.js';
import { OrdersController } from './modules/orders/orders.controller.js';
import { OrdersService } from './modules/orders/orders.service.js';
import { SyncController } from './modules/sync/sync.controller.js';
import { ApprovalsController } from './modules/approvals/approvals.controller.js';
import { ApprovalsService } from './modules/approvals/approvals.service.js';
import { PlanningController } from './modules/planning/planning.controller.js';
import { PlanningService } from './modules/planning/planning.service.js';
import { TransferService } from './modules/transfer/transfer.service.js';
import { MaterialService } from './modules/material/material.service.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ReportService } from './modules/docs/report.service.js';
import { AzureBlobStorage, LocalBlobStorage } from './modules/files/blob-storage.js';
import { LocalBlobController } from './modules/files/blob.controller.js';
import {
  ChatController,
  NotificationsController,
  PhotosController,
  SpeechController,
  ReportController,
  TemplatesController,
} from './modules/files/comm.controller.js';
import { CommService } from './modules/files/comm.service.js';
import { BLOB_STORAGE } from './modules/files/files.tokens.js';
import { NoRealtime, REALTIME, WebPubSubRealtime } from './modules/files/realtime.js';
import { AzureSpeech, NoRewrite, SPEECH, TEXT_REWRITE } from './modules/files/speech.js';
import { ContainersController, MaterialController } from './modules/material/material.controller.js';
import { SyncService } from './modules/sync/sync.service.js';
import { TimeService } from './modules/time/time.service.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [DbModule],
      controllers: [
        HealthController,
        DevAuthController,
        MeController,
        OrdersController,
        AdminController,
        SyncController,
        PlanningController,
        ApprovalsController,
        TransfersController,
        MaterialController,
        ContainersController,
        PhotosController,
        ChatController,
        NotificationsController,
        SpeechController,
        TemplatesController,
        LocalBlobController,
        ReportController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        TokenVerifier,
        ScopeService,
        FeatureService,
        AuditService,
        OrdersService,
        SyncService,
        PlanningService,
        ApprovalsService,
        TransferService,
        MaterialService,
        ReportService,
        CommService,
        {
          provide: BLOB_STORAGE,
          useFactory: () =>
            config.STORAGE_MODE === 'azure'
              ? new AzureBlobStorage(config.STORAGE_ACCOUNT_URL!, config.STORAGE_CONTAINER)
              : new LocalBlobStorage(
                  resolve(config.LOCAL_STORAGE_DIR),
                  config.PUBLIC_API_URL,
                  config.DEV_AUTH_SECRET ?? randomUUID(),
                ),
        },
        {
          provide: REALTIME,
          useFactory: () =>
            config.WEB_PUBSUB_ENDPOINT
              ? new WebPubSubRealtime(config.WEB_PUBSUB_ENDPOINT, config.WEB_PUBSUB_HUB)
              : new NoRealtime(),
        },
        { provide: SPEECH, useFactory: () => new AzureSpeech(config.SPEECH_REGION, config.SPEECH_KEY) },
        { provide: TEXT_REWRITE, useFactory: () => new NoRewrite() },
        TimeService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: HttpErrorFilter },
      ],
      exports: [APP_CONFIG],
    };
  }
}
