import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { isRole, type Role } from '@schroeder/shared';
import { APP_CONFIG, type AppConfig } from '../config.js';
import type { Principal } from './auth.types.js';

export const DEV_ISSUER = 'urn:schroeder:monteur-app:dev';
export const DEV_AUDIENCE = 'urn:schroeder:monteur-app:api';

export class InvalidTokenError extends Error {}

@Injectable()
export class TokenVerifier {
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly devKey?: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.AUTH_MODE === 'entra') {
      this.jwks = createRemoteJWKSet(
        new URL(`https://login.microsoftonline.com/${config.ENTRA_TENANT_ID}/discovery/v2.0/keys`),
      );
    } else {
      this.devKey = new TextEncoder().encode(config.DEV_AUTH_SECRET);
    }
  }

  async verify(token: string): Promise<Principal> {
    let payload: JWTPayload;
    try {
      if (this.jwks) {
        ({ payload } = await jwtVerify(token, this.jwks, {
          issuer: `https://login.microsoftonline.com/${this.config.ENTRA_TENANT_ID}/v2.0`,
          audience: this.config.ENTRA_API_AUDIENCE,
          algorithms: ['RS256'],
        }));
        if (payload.tid !== this.config.ENTRA_TENANT_ID) throw new InvalidTokenError('foreign tenant');
      } else {
        ({ payload } = await jwtVerify(token, this.devKey!, {
          issuer: DEV_ISSUER,
          audience: DEV_AUDIENCE,
          algorithms: ['HS256'],
        }));
      }
    } catch (e) {
      throw new InvalidTokenError(e instanceof Error ? e.message : 'invalid token');
    }
    const oid = typeof payload.oid === 'string' ? payload.oid : undefined;
    if (!oid) throw new InvalidTokenError('missing oid claim');
    const rawRoles = Array.isArray(payload.roles) ? (payload.roles as unknown[]) : [];
    return {
      oid,
      tid: typeof payload.tid === 'string' ? payload.tid : undefined,
      name: typeof payload.name === 'string' ? payload.name : '',
      email:
        typeof payload.preferred_username === 'string'
          ? payload.preferred_username
          : typeof payload.email === 'string'
            ? payload.email
            : '',
      roles: rawRoles.filter((r): r is Role => typeof r === 'string' && isRole(r)),
    };
  }

  /** Issues a dev token (AUTH_MODE=dev only; used by the dev login and tests). */
  async issueDevToken(
    claims: { oid: string; name: string; email: string; roles: Role[] },
    ttlSeconds = 8 * 3600,
  ) {
    if (!this.devKey) throw new Error('dev tokens are disabled');
    return new SignJWT({ ...claims, preferred_username: claims.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(DEV_ISSUER)
      .setAudience(DEV_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.devKey);
  }
}
