'use client';

import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch, ApiError, setTokenProvider } from '../api';
import { config } from '../config';
import { localDb } from '../offline/db';
import type { Me } from '../types';

type Status = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: Status;
  me: Me | null;
  /** True when `me` comes from the local cache because the API is unreachable. */
  offlineSession: boolean;
  login: (personaKey?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const DEV_TOKEN_KEY = 'monteur.devToken';
const ME_CACHE_KEY = 'me';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/**
 * Authentication. Entra mode uses MSAL (redirect flow, tokens cached in localStorage so the installed PWA
 * keeps the session across restarts). Dev mode signs in as a seeded persona via /dev/token.
 * The last known profile is cached in IndexedDB so the app keeps working offline.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [offlineSession, setOfflineSession] = useState(false);
  const msal = useRef<PublicClientApplication | null>(null);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (config.authMode === 'dev') return sessionStorage.getItem(DEV_TOKEN_KEY);
    const pca = msal.current;
    const account: AccountInfo | null = pca?.getActiveAccount() ?? pca?.getAllAccounts()[0] ?? null;
    if (!pca || !account) return null;
    try {
      const r = await pca.acquireTokenSilent({ scopes: [config.entra.apiScope], account });
      return r.accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError && navigator.onLine) {
        await pca.acquireTokenRedirect({ scopes: [config.entra.apiScope], account });
      }
      return null;
    }
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const profile = await apiFetch<Me>('/v1/me');
      setMe(profile);
      setOfflineSession(false);
      await localDb.kv.put({ key: ME_CACHE_KEY, value: profile });
      setStatus('signed-in');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setStatus('signed-out');
        return;
      }
      // Network error: continue with the cached profile (offline-first).
      const cached = (await localDb.kv.get(ME_CACHE_KEY))?.value as Me | undefined;
      if (cached) {
        setMe(cached);
        setOfflineSession(true);
        setStatus('signed-in');
      } else setStatus('signed-out');
    }
  }, []);

  useEffect(() => {
    setTokenProvider(getToken);
    (async () => {
      if (config.authMode === 'entra') {
        const pca = new PublicClientApplication({
          auth: {
            clientId: config.entra.clientId,
            authority: `https://login.microsoftonline.com/${config.entra.tenantId}`,
            redirectUri: `${window.location.origin}${config.basePath}/login`,
          },
          cache: { cacheLocation: 'localStorage' },
        });
        await pca.initialize();
        const result = await pca.handleRedirectPromise();
        if (result?.account) pca.setActiveAccount(result.account);
        msal.current = pca;
        if (!pca.getAllAccounts().length) {
          setStatus('signed-out');
          return;
        }
      } else if (!sessionStorage.getItem(DEV_TOKEN_KEY)) {
        setStatus('signed-out');
        return;
      }
      await refreshMe();
    })().catch(() => setStatus('signed-out'));
  }, [getToken, refreshMe]);

  const login = useCallback(
    async (personaKey?: string) => {
      if (config.authMode === 'dev') {
        const personas =
          await apiFetch<Array<{ key: string; oid: string; name: string; email: string; roles: string[] }>>(
            '/dev/personas',
          );
        const p = personas.find((x) => x.key === personaKey);
        if (!p) throw new Error('Unbekannte Testperson');
        const { accessToken } = await apiFetch<{ accessToken: string }>('/dev/token', {
          method: 'POST',
          body: JSON.stringify({ oid: p.oid, name: p.name, email: p.email, roles: p.roles }),
        });
        sessionStorage.setItem(DEV_TOKEN_KEY, accessToken);
        await refreshMe();
        return;
      }
      await msal.current?.loginRedirect({ scopes: [config.entra.apiScope] });
    },
    [refreshMe],
  );

  const logout = useCallback(async () => {
    const pending = await localDb.outbox.filter((e) => e.status !== 'rejected').count();
    if (
      pending &&
      !window.confirm(
        `${pending} Einträge sind noch nicht übertragen. Sie bleiben auf dem Gerät und werden nach Ihrer nächsten Anmeldung gesendet. Trotzdem abmelden?`,
      )
    )
      return;
    // Personal data cache is removed on logout (E-30); the outbox stays bound to its owner.
    await localDb.clearCache(true);
    setMe(null);
    setStatus('signed-out');
    if (config.authMode === 'dev') sessionStorage.removeItem(DEV_TOKEN_KEY);
    else await msal.current?.logoutRedirect();
  }, []);

  const value = useMemo(
    () => ({ status, me, offlineSession, login, logout, refreshMe }),
    [status, me, offlineSession, login, logout, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
