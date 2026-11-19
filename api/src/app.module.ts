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
        TimeService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: HttpErrorFilter },
      ],
      exports: [APP_CONFIG],
    };
  }
}
