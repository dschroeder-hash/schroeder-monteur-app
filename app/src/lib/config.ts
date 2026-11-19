export const config = {
  authMode: (process.env.NEXT_PUBLIC_AUTH_MODE ?? 'entra') as 'entra' | 'dev',
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  entra: {
    clientId: process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID ?? '',
    tenantId: process.env.NEXT_PUBLIC_ENTRA_TENANT_ID ?? '',
    apiScope: process.env.NEXT_PUBLIC_ENTRA_API_SCOPE ?? '',
  },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
};
