import { config } from './config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

export type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;
export function setTokenProvider(p: TokenProvider) {
  tokenProvider = p;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await tokenProvider();
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? res.statusText, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
