import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Feature, Role } from '@schroeder/shared';
import type { AccessScope } from './auth.types.js';

export const PUBLIC_KEY = 'auth:public';
export const ROLES_KEY = 'auth:roles';
export const FEATURE_KEY = 'auth:feature';

/** Endpoint is reachable without authentication (health, dev login). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** At least one of the given roles is required. Without this decorator any authenticated user passes. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
/** Module must be enabled (feature flag) for at least one of the user's locations. */
export const RequireFeature = (feature: Feature) => SetMetadata(FEATURE_KEY, feature);

export const Scope = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessScope => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.scope) throw new Error('Scope requested on an unauthenticated route');
  return req.scope;
});
