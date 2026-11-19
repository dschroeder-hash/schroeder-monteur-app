import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Feature, Role } from '@schroeder/shared';
import { FeatureService } from '../features/feature.service.js';
import { FEATURE_KEY, PUBLIC_KEY, ROLES_KEY } from './decorators.js';
import { ScopeService, UserInactiveError } from './scope.service.js';
import { InvalidTokenError, TokenVerifier } from './token-verifier.js';

/**
 * Global guard: authentication → scope resolution → role check → feature flag check.
 * Deny by default: every route requires a valid token unless marked @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(ScopeService) private readonly scopes: ScopeService,
    @Inject(FeatureService) private readonly features: FeatureService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) throw new UnauthorizedException('Anmeldung erforderlich');

    try {
      req.principal = await this.verifier.verify(match[1]);
      req.scope = await this.scopes.resolve(req.principal);
    } catch (e) {
      if (e instanceof InvalidTokenError)
        throw new UnauthorizedException('Anmeldung ungültig oder abgelaufen');
      if (e instanceof UserInactiveError) throw new ForbiddenException('Benutzer ist deaktiviert');
      throw e;
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && !roles.some((r) => req.scope!.roles.includes(r)))
      throw new ForbiddenException('Keine Berechtigung für diese Funktion');

    const feature = this.reflector.getAllAndOverride<Feature | undefined>(FEATURE_KEY, targets);
    if (feature && !(await this.features.isEnabledForAny(feature, req.scope.locationIds)))
      throw new ForbiddenException('Diese Funktion ist für Ihren Standort nicht freigeschaltet');

    return true;
  }
}
