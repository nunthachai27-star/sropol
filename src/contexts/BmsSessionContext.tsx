'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  extractConnectionConfig,
  extractUserInfo,
  probeLocalApi,
  retrieveBmsSession,
  setActiveMarketplaceToken,
} from '@/lib/bms-browser-client';
import {
  getMarketplaceToken,
  getSessionFromUrl,
  handleUrlMarketplaceToken,
  handleUrlSession,
  removeMarketplaceToken,
  removeSessionCookie,
} from '@/utils/bms-session-storage';
import type { ConnectionConfig, UserInfo } from '@/types/bms-browser';

const AUTH_PROVIDER_STORAGE_KEY = 'kk-lrms:auth-provider';

export interface BmsSessionContextValue {
  config: ConnectionConfig | null;
  userInfo: UserInfo | null;
  /**
   * The BMS PasteJSON session id the active config was derived from (the
   * `?bms-session-id=` handle). Exposed so the browser-poll can stamp it on
   * each push — it is the operator's handle for running diagnostic SQL
   * against this hospital's HOSxP via the BMS Session API.
   */
  sessionId: string | null;
  /** Marketplace token paired with the active session, if any */
  marketplaceToken: string | null;
  /** True when both config and userInfo are loaded */
  isReady: boolean;
  error: string | null;
  refresh: (sessionId: string) => Promise<void>;
  /** Wipes cookie + state; caller is responsible for redirecting */
  clear: () => void;
}

const BmsSessionContext = createContext<BmsSessionContextValue | null>(null);

export function useBmsSession(): BmsSessionContextValue {
  const ctx = useContext(BmsSessionContext);
  if (!ctx) {
    throw new Error('useBmsSession must be called inside <BmsSessionProvider>');
  }
  return ctx;
}

export function BmsSessionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConnectionConfig | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [marketplaceToken, setMarketplaceTokenState] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSessionRef = useRef<string | null>(null);

  // Keep the bms-browser-client module-level singleton in sync so every
  // /api/sql and /api/rest call auto-picks up the token without the caller
  // having to thread it through (matches hosxp-telemed's activeSession
  // pattern).
  const publishMarketplaceToken = useCallback((token: string | null) => {
    setMarketplaceTokenState(token);
    setActiveMarketplaceToken(token);
  }, []);

  const refresh = useCallback(async (sessionId: string) => {
    setError(null);
    try {
      const response = await retrieveBmsSession(sessionId);
      const cfg = extractConnectionConfig(response);
      const ui = extractUserInfo(response);
      setConfig(cfg);
      setUserInfo(ui);
      setSessionId(sessionId);
      lastSessionRef.current = sessionId;

      // Background local-API probe. The user's session is "ready" the
      // moment we set cfg above; the probe runs after and swaps the
      // apiUrl to http://127.0.0.1:45011 if the local HOSxP gateway is
      // reachable. Saves the Cloudflare-tunnel hop on every browser-side
      // call (live ward view, partograph save, vital-sign save).
      // Guarded against stale promises: only apply the swap if the
      // session that started this probe is still the active one.
      void (async () => {
        const { config: localCfg, isLocal } = await probeLocalApi(cfg);
        if (isLocal && lastSessionRef.current === sessionId) {
          setConfig(localCfg);
        }
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setConfig(null);
      setUserInfo(null);
      setSessionId(null);
    }
  }, []);

  const clear = useCallback(() => {
    setConfig(null);
    setUserInfo(null);
    setSessionId(null);
    setError(null);
    removeSessionCookie();
    removeMarketplaceToken();
    publishMarketplaceToken(null);
    lastSessionRef.current = null;
  }, [publishMarketplaceToken]);

  // Bootstrap on mount: read URL session ID, persist to cookie, hydrate context.
  useEffect(() => {
    const authProvider =
      typeof window !== 'undefined' ? window.localStorage.getItem(AUTH_PROVIDER_STORAGE_KEY) : null;
    if (authProvider === 'provider-id') {
      removeSessionCookie();
      removeMarketplaceToken();
      lastSessionRef.current = null;
      queueMicrotask(() => {
        publishMarketplaceToken(null);
        setConfig(null);
        setUserInfo(null);
        setSessionId(null);
        setError(null);
      });
      return;
    }

    // Marketplace token pairing: if a NEW session arrives via URL without a
    // paired marketplace_token, drop the stale token. This matches the
    // hosxp-telemed pattern — a fresh session ID without an accompanying
    // marketplace_token means any previously-stored token is stale.
    const urlSessionId = getSessionFromUrl();
    const urlHasMarketplaceToken =
      typeof window !== 'undefined' &&
      (window.location.search.includes('marketplace_token=') ||
        window.location.search.includes('marketplace-token='));

    let resolvedToken: string | null = null;
    if (urlSessionId && urlSessionId !== lastSessionRef.current) {
      if (urlHasMarketplaceToken) {
        resolvedToken = handleUrlMarketplaceToken(); // persists + strips
      } else {
        removeMarketplaceToken(); // drop stale, new session stands alone
        resolvedToken = null;
      }
    } else {
      resolvedToken = getMarketplaceToken();
    }
    queueMicrotask(() => {
      publishMarketplaceToken(resolvedToken);
    });

    const sid = handleUrlSession(); // reads URL, persists cookie, strips URL
    if (sid) {
      // Defer the kick-off so the inner setState calls inside refresh() do
      // not run synchronously inside the effect body
      // (react-hooks/set-state-in-effect). The async fetch makes this a
      // genuine "synchronize with external system" effect.
      queueMicrotask(() => {
        void refresh(sid);
      });
    }
  }, [refresh, publishMarketplaceToken]);

  const isReady = config !== null && userInfo !== null;

  return (
    <BmsSessionContext.Provider
      value={{ config, userInfo, sessionId, marketplaceToken, isReady, error, refresh, clear }}
    >
      {children}
    </BmsSessionContext.Provider>
  );
}
