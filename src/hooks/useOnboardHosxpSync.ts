'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useBmsSession } from '@/contexts/BmsSessionContext';
import { withBasePath } from '@/lib/base-path';

export interface OnboardHosxpSyncState {
  ran: boolean;
  started?: boolean;
  alreadyRunning?: boolean;
  hcode?: string;
  databaseType?: string;
  intervalMs?: number;
  ttlMs?: number;
  running?: boolean;
  phase?: string;
  startedAt?: string | null;
  expiresAt?: string | null;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastError?: string | null;
  nextRunAt?: string | null;
  cycleCount?: number;
  successCount?: number;
  connectionStatus?: string | null;
  hospitalLastSyncAt?: string | null;
  activePatients?: number;
  cachedPatients?: number;
  latestPatientSyncedAt?: string | null;
  activeAncJourneys?: number;
  latestAncSyncedAt?: string | null;
  activeReferrals?: number;
  outgoingReferrals?: number;
  incomingReferrals?: number;
  lastStats?: {
    activePatientsRead: number;
    activePatientsSynced: number;
    partographRowsRead: number;
    partographRowsUpserted: number;
    anc: {
      attempted: boolean;
      sourcePatientsRead: number;
      sourcePatientsMapped: number;
      servicesRead: number;
      servicesMapped: number;
      risksRead: number;
      risksMapped: number;
      classifyingRead: number;
      classifyingMapped: number;
      addressesRead: number;
      addressesMapped: number;
      patientsSynced: number;
      skippedReason: string | null;
      error: string | null;
    };
  } | null;
  lastSteps?: Array<{
    at: string;
    cycle: number;
    name: string;
    status: 'running' | 'success' | 'warning' | 'error' | 'info';
    message: string;
    detail?: string;
    counts?: Record<string, number>;
  }>;
  statusCode?: number;
  stage?: string;
  detail?: string;
  error?: string;
}

type HosxpSyncStatusPayload = Partial<OnboardHosxpSyncState> & {
  ok?: boolean;
  message?: string;
};

export function useOnboardHosxpSync(): {
  state: OnboardHosxpSyncState | null;
} {
  const { data: session, status } = useSession();
  const { config, userInfo, marketplaceToken, isReady } = useBmsSession();
  const ranRef = useRef(false);
  const [state, setState] = useState<OnboardHosxpSyncState | null>(null);

  useEffect(() => {
    if (ranRef.current) return;
    // Gate on a CONFIRMED NextAuth session: the POST to /api/onboarding/hosxp-sync
    // is redirected to /login by the middleware when unauthenticated, and a POST
    // to the login page route returns HTTP 405. The BMS context can become ready
    // before useSession() resolves (e.g. right after auto-login), so without this
    // gate the request fires unauthenticated and surfaces "HOSxP SYNC ERROR".
    // Return WITHOUT setting ranRef so it retries once the session hydrates.
    // (Mirrors the same gate in useOnboardHosxpWebhook.)
    if (status !== 'authenticated' || !session?.user) return;
    if (session.user.authProvider === 'provider-id' || session.user.accessMode === 'readonly') {
      ranRef.current = true;
      queueMicrotask(() => setState({ ran: false }));
      return;
    }
    if (!isReady || !config || !userInfo) return;
    // Gate auto-sync on a paired marketplace_token. Sessions launched without
    // one (direct paste of bms-session-id) lack the marketplace scope that
    // /api/sql + /api/function rely on for READWRITE, and silently failing
    // half-way through onboarding is worse than not starting. Mirrors the
    // existing precondition in useOnboardHosxpWebhook.
    if (!marketplaceToken) return;
    if (!userInfo.hospcode) {
      ranRef.current = true;
      queueMicrotask(() => {
        setState({ ran: false, error: 'missing hospital code in BMS session' });
      });
      return;
    }

    ranRef.current = true;
    void (async () => {
      try {
        const res = await fetch(withBasePath('/api/onboarding/hosxp-sync'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiUrl: config.apiUrl,
            bearerToken: config.bearerToken,
            marketplaceToken,
            // A user opening / or /hospital-maternity-ward with a valid
            // BMS+marketplace session is an explicit re-onboard signal —
            // the hook is ref-guarded (fires at most once per tab) and is
            // NOT mounted on /admin, so this can't accidentally undo an
            // admin's mid-purge action from their own tab. If a permanent
            // block is needed, admins should also flip the hospital to
            // is_active=false rather than relying on the purge flag.
            confirmReonboard: true,
          }),
          keepalive: true,
        });
        const payload = (await res.json().catch(() => ({}))) as {
          started?: boolean;
          alreadyRunning?: boolean;
          hcode?: string;
          databaseType?: string;
          intervalMs?: number;
          ttlMs?: number;
          stage?: string;
          detail?: string;
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          setState({
            ran: true,
            statusCode: res.status,
            hcode: payload.hcode,
            stage: payload.stage,
            error: payload.error ?? payload.message ?? `HTTP ${res.status}`,
            detail: payload.detail ?? payload.message,
          });
          ranRef.current = false;
          return;
        }
        setState({
          ran: true,
          hcode: payload.hcode,
          started: payload.started,
          alreadyRunning: payload.alreadyRunning,
          databaseType: payload.databaseType,
          intervalMs: payload.intervalMs,
          ttlMs: payload.ttlMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[onboarding] HOSxP background sync start failed:', message);
        ranRef.current = false;
        setState({ ran: true, error: message, detail: 'Browser could not reach /api/onboarding/hosxp-sync.' });
      }
    })();
  }, [
    config,
    isReady,
    marketplaceToken,
    status,
    session?.user,
    session?.user?.accessMode,
    session?.user?.authProvider,
    userInfo,
  ]);

  useEffect(() => {
    if (!state?.ran || state.error) return;
    if (!state.started && !state.alreadyRunning) return;

    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const res = await fetch(withBasePath('/api/onboarding/hosxp-sync'), {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await res.json().catch(() => ({}))) as HosxpSyncStatusPayload;
        if (cancelled) return;
        if (!res.ok) {
          setState((prev) => ({
            ...(prev ?? { ran: true }),
            statusCode: res.status,
            error: payload.error ?? payload.message ?? `HTTP ${res.status}`,
            detail: payload.detail,
          }));
          return;
        }
        setState((prev) => ({
          ...(prev ?? { ran: true }),
          ...payload,
          ran: true,
        }));
      } catch {
        // Leave the last known good status visible.
      }
    };

    void refreshStatus();
    const interval = setInterval(() => {
      void refreshStatus();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state?.alreadyRunning, state?.error, state?.ran, state?.started]);

  return { state };
}
