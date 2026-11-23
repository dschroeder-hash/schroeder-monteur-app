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
    /** Delegated scope the app requests (api://…/access_as_user). */
    ENTRA_REQUIRED_SCOPE: z.string().default('access_as_user'),
    /** Comma-separated client ids allowed to call the API (azp); empty = any client of the tenant with the scope. */
    ENTRA_ALLOWED_CLIENT_IDS: z.string().optional(),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    /** Reverse proxies in front of the API (Front Door + Container Apps ingress = 2) – for client IPs in rate limits. */
    /** Database connections per API instance (pool). Under load more instances scale out (Container Apps rule). */
    DB_POOL_MAX: z.coerce.number().int().min(2).max(100).default(20),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Azure Front Door profile id; when set, requests without the matching X-Azure-FDID header are refused. */
    FRONT_DOOR_ID: z.string().uuid().optional(),
    /** Requests per minute per signed-in user (anonymous: per IP, a quarter of it). 0 = off. */
    RATE_LIMIT_PER_MIN: z.coerce.number().int().min(0).default(600),
    /** Set by Azure Container Apps – used to refuse dev auth in any Azure deployment. */
    CONTAINER_APP_NAME: z.string().optional(),
    BC_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
    BC_API_BASE_URL: z.string().url().default('http://localhost:4100/api'),
    BC_TOKEN_URL: z.string().url().default('http://localhost:4100/oauth2/token'),
    BC_CLIENT_ID: z.string().default('mock'),
    BC_CLIENT_SECRET: z.string().default('mock'),
    BC_SCOPE: z.string().default('https://api.businesscentral.dynamics.com/.default'),
    BC_SYNC_INTERVAL_SEC: z.coerce.number().min(60).max(600).default(180),
    /** Photos: 'azure' (Blob Storage, user delegation SAS) or 'local' (dev/test, files under LOCAL_STORAGE_DIR). */
    STORAGE_MODE: z.enum(['azure', 'local']).default('local'),
    STORAGE_ACCOUNT_URL: z.string().url().optional(),
    STORAGE_CONTAINER: z.string().default('photos'),
    LOCAL_STORAGE_DIR: z.string().default('./var/uploads'),
    /** Public base URL of this API (signed local blob URLs). */
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    /** Web Push (VAPID). Generate with `npx web-push generate-vapid-keys`. */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:werkstatt-app@example.invalid'),
    /** Azure Web PubSub endpoint (Managed Identity); without it clients fall back to polling. */
    WEB_PUBSUB_ENDPOINT: z.string().url().optional(),
    WEB_PUBSUB_HUB: z.string().default('werkstatt'),
    /** Azure AI Speech (dictation fallback). */
    SPEECH_REGION: z.string().default('germanywestcentral'),
    // Photos to M-Files (E-73, OP-48). Without MFILES_BASE_URL the hand-over is off.
    MFILES_BASE_URL: z.string().url().optional(),
    MFILES_VAULT_GUID: z.string().optional(),
    MFILES_USERNAME: z.string().optional(),
    MFILES_PASSWORD: z.string().optional(),
    MFILES_MACHINE_OBJECT_TYPE: z.coerce.number().int().optional(),
    MFILES_MACHINE_KEY_PROPERTY: z.coerce.number().int().optional(),
    MFILES_PHOTO_CLASS: z.coerce.number().int().optional(),
    MFILES_MACHINE_LOOKUP_PROPERTY: z.coerce.number().int().optional(),
    MFILES_ORDER_NO_PROPERTY: z.coerce.number().int().optional(),
    SPEECH_KEY: z.string().optional(),
    /**
     * Reading the manufacturer cart from a screenshot (E-76): 'claude' (Anthropic API, ANTHROPIC_API_KEY),
     * 'mock' (dev/test: fixed lines, no external call) or 'off'.
     */
    CART_AI: z.enum(['off', 'claude', 'mock']).default('off'),
    CART_AI_MODEL: z.string().default('claude-opus-5-5'),
    /** Set by the worker entry point: the worker does not validate user tokens. */
    COMPONENT: z.enum(['api', 'worker']).default('api'),
  })
  .superRefine((c, ctx) => {
    if (c.APP_ENV === 'prod' && c.AUTH_MODE === 'dev')
      ctx.addIssue({ code: 'custom', message: 'AUTH_MODE=dev is not allowed in prod', path: ['AUTH_MODE'] });
    // Test environments in Azure are internet-facing too: dev tokens there would let anyone become Admin.
    if (c.CONTAINER_APP_NAME && c.AUTH_MODE === 'dev')
      ctx.addIssue({
        code: 'custom',
        message: 'AUTH_MODE=dev is not allowed in Azure deployments',
        path: ['AUTH_MODE'],
      });
    if (c.APP_ENV === 'prod' && c.STORAGE_MODE === 'local')
      ctx.addIssue({
        code: 'custom',
        message: 'STORAGE_MODE=local is not allowed in prod',
        path: ['STORAGE_MODE'],
      });
    if (c.STORAGE_MODE === 'azure' && !c.STORAGE_ACCOUNT_URL)
      ctx.addIssue({
        code: 'custom',
        message: 'STORAGE_ACCOUNT_URL is required for STORAGE_MODE=azure',
        path: ['STORAGE_ACCOUNT_URL'],
      });
    if (c.APP_ENV === 'prod' && c.BC_MODE === 'mock')
      ctx.addIssue({ code: 'custom', message: 'BC_MODE=mock is not allowed in prod', path: ['BC_MODE'] });
    if (c.COMPONENT === 'api' && c.AUTH_MODE === 'entra' && (!c.ENTRA_TENANT_ID || !c.ENTRA_API_AUDIENCE))
      ctx.addIssue({
        code: 'custom',
        message: 'ENTRA_TENANT_ID and ENTRA_API_AUDIENCE are required',
        path: ['AUTH_MODE'],
      });
    if (c.COMPONENT === 'api' && c.AUTH_MODE === 'dev' && !c.DEV_AUTH_SECRET)
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
