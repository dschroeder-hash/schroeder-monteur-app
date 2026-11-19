import { z } from 'zod';

const schema = z
  .object({
    APP_ENV: z.enum(['dev', 'test', 'prod']).default('dev'),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().url(),
    /** 'entra' validates Microsoft Entra ID tokens; 'dev' accepts locally signed tokens (never in prod). */
    AUTH_MODE: z.enum(['entra', 'dev']).default('entra'),
    ENTRA_TENANT_ID: z.string().optional(),
    /** Application ID URI or client id of the API app registration. */
    ENTRA_API_AUDIENCE: z.string().optional(),
    DEV_AUTH_SECRET: z.string().min(32).optional(),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    BC_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    BC_API_BASE_URL: z.string().url().default('http://localhost:4100/api'),
    BC_TOKEN_URL: z.string().url().default('http://localhost:4100/oauth2/token'),
    BC_CLIENT_ID: z.string().default('mock'),
    BC_CLIENT_SECRET: z.string().default('mock'),
    BC_SCOPE: z.string().default('https://api.businesscentral.dynamics.com/.default'),
  })
  .superRefine((c, ctx) => {
    if (c.APP_ENV === 'prod' && c.AUTH_MODE === 'dev')
      ctx.addIssue({ code: 'custom', message: 'AUTH_MODE=dev is not allowed in prod', path: ['AUTH_MODE'] });
    if (c.APP_ENV === 'prod' && c.BC_MODE === 'mock')
      ctx.addIssue({ code: 'custom', message: 'BC_MODE=mock is not allowed in prod', path: ['BC_MODE'] });
    if (c.AUTH_MODE === 'entra' && (!c.ENTRA_TENANT_ID || !c.ENTRA_API_AUDIENCE))
      ctx.addIssue({
        code: 'custom',
        message: 'ENTRA_TENANT_ID and ENTRA_API_AUDIENCE are required',
        path: ['AUTH_MODE'],
      });
    if (c.AUTH_MODE === 'dev' && !c.DEV_AUTH_SECRET)
      ctx.addIssue({
        code: 'custom',
        message: 'DEV_AUTH_SECRET is required for AUTH_MODE=dev',
        path: ['DEV_AUTH_SECRET'],
      });
  });

export type AppConfig = z.infer<typeof schema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration:\n${parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}
