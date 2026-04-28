// Hook that auto-provisions the HOSxP webhook_setting row for KK-LRMS
// when a user lands on `/` with a valid BMS session + marketplace_token.
//
// Flow:
//   1. Query HOSxP via BMS /api/sql:
//        SELECT COUNT(*) AS n FROM webhook_setting
//        WHERE webhook_module_id = 3 AND webhook_setting_code = 'KK-LRMS'
//   2. If a row already exists → done, remember for this tab.
//   3. If not:
//        a. POST /api/onboarding/webhook-key  (mints a KK-LRMS API key
//           bound to the session's hospital, returns the raw key once).
//        b. POST /api/rest/webhook_setting via BMS with:
//             webhook_module_id        = 3
//             webhook_setting_code     = 'KK-LRMS'
//             webhook_authorization_key = <the raw key>
//             webhook_url              = <KK-LRMS public webhook URL>
//
// Ref-guarded so it runs at most once per tab/session even under
// React-strict-mode double mount. SessionStorage persists two separate
// markers per hospital code:
//   DONE    — final success; skip provisioning on future mounts
//   PENDING — mint succeeded but the HOSxP insert failed. On retry we
//             reuse the cached key instead of minting another one, to
//             prevent orphaned keys accumulating on transient BMS errors.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useBmsSession } from '@/contexts/BmsSessionContext';
import { executeSql, restInsert, restUpdate } from '@/lib/bms-browser-client';
import { mintSerial } from '@/lib/bms-serial';

const DONE_STORAGE_KEY = 'kk-lrms:hosxp-webhook-onboarded';
const PENDING_STORAGE_KEY = 'kk-lrms:hosxp-webhook-pending-key';
const WEBHOOK_MODULE_ID = 3;
const WEBHOOK_SETTING_CODE = 'KK-LRMS';

function resolveKkLrmsWebhookUrl(): string {
  if (typeof window === 'undefined') return '';
  // Reuse the deployed origin — HOSxP will POST back here with the auth key.
  // Override via NEXT_PUBLIC_KK_LRMS_PUBLIC_URL when the public origin
  // differs from window.location (e.g. behind a reverse proxy).
  const override = process.env.NEXT_PUBLIC_KK_LRMS_PUBLIC_URL;
  const origin = override && override.length > 0 ? override : window.location.origin;
  return `${origin.replace(/\/$/, '')}/api/webhooks/patient-data`;
}

interface PendingKey {
  apiKey: string;
  keyPrefix: string;
}

function hasSessionStorage(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage;
}

function readDone(hcode: string): boolean {
  if (!hasSessionStorage() || !hcode) return false;
  return window.sessionStorage.getItem(`${DONE_STORAGE_KEY}:${hcode}`) === '1';
}

function writeDone(hcode: string): void {
  if (!hasSessionStorage() || !hcode) return;
  window.sessionStorage.setItem(`${DONE_STORAGE_KEY}:${hcode}`, '1');
}

function readPending(hcode: string): PendingKey | null {
  if (!hasSessionStorage() || !hcode) return null;
  try {
    const raw = window.sessionStorage.getItem(`${PENDING_STORAGE_KEY}:${hcode}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingKey>;
    if (typeof parsed.apiKey === 'string' && typeof parsed.keyPrefix === 'string') {
      return { apiKey: parsed.apiKey, keyPrefix: parsed.keyPrefix };
    }
  } catch {
    // ignore corrupt entry — treat as no pending
  }
  return null;
}

function writePending(hcode: string, key: PendingKey): void {
  if (!hasSessionStorage() || !hcode) return;
  window.sessionStorage.setItem(
    `${PENDING_STORAGE_KEY}:${hcode}`,
    JSON.stringify(key),
  );
}

function clearPending(hcode: string): void {
  if (!hasSessionStorage() || !hcode) return;
  window.sessionStorage.removeItem(`${PENDING_STORAGE_KEY}:${hcode}`);
}

// Fire-and-forget server-side trace so we can see which branch the hook
// actually took from Docker logs (the hook's own catch branch only logs to
// the browser console, which is invisible in production support scenarios).
// Never await — onboarding must not wait on logging, and a log failure must
// not break the flow.
function traceStep(event: string, detail?: Record<string, unknown>): void {
  try {
    void fetch('/api/onboarding/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, detail }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Synchronous failures (e.g. CSP blocking fetch) are non-fatal.
  }
}

export interface OnboardHosxpWebhookResult {
  ran: boolean;
  alreadyExisted?: boolean;
  createdKeyPrefix?: string;
  error?: string;
}

export function useOnboardHosxpWebhook(): {
  state: OnboardHosxpWebhookResult | null;
} {
  const { config, userInfo, marketplaceToken, isReady } = useBmsSession();
  const ranRef = useRef(false);
  const stateRef = useRef<OnboardHosxpWebhookResult | null>(null);
  // Mirror the ref into React state so the dashboard can render the error
  // banner — refs don't trigger re-renders on their own.
  const [state, setState] = useState<OnboardHosxpWebhookResult | null>(null);
  const publish = (next: OnboardHosxpWebhookResult | null) => {
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    if (ranRef.current) return;
    if (!isReady || !config || !userInfo || !marketplaceToken) {
      // Key names avoid "token"/"jwt"/etc. so the PDPA redactor doesn't swap
      // these booleans for "[REDACTED]" and erase the signal we need.
      traceStep('preconditions_missing', {
        isReady,
        hasConfig: !!config,
        hasUserInfo: !!userInfo,
        hasMpSession: !!marketplaceToken,
      });
      return;
    }
    const hcode = userInfo.hospcode;
    if (!hcode) {
      // No hcode means we have nothing to key provisioning against. Bail
      // silently — the admin can still provision manually via /admin.
      traceStep('preconditions_missing', { reason: 'no_hcode_in_user_info' });
      ranRef.current = true;
      return;
    }
    traceStep('preconditions_ok', { hcode });

    // Fast path: already provisioned in this tab/session.
    if (readDone(hcode)) {
      traceStep('skipped_done', { hcode });
      ranRef.current = true;
      publish({ ran: false, alreadyExisted: true });
      return;
    }

    ranRef.current = true;
    void (async () => {
      try {
        // Step 1 — reuse-or-mint the KK-LRMS webhook key on the server side.
        // The endpoint returns { alreadyExists: true, ... } if a key is
        // already on file for this hospital; in that case we intentionally
        // do NOT touch HOSxP's webhook_setting, trusting the original
        // provisioning run left it in sync. Only a first-time (or recovery)
        // path mints a new raw key and pushes it to HOSxP.
        let minted: PendingKey | null = readPending(hcode);
        if (minted) {
          traceStep('reused_pending_key', { hcode, keyPrefix: minted.keyPrefix });
        } else {
          const res = await fetch('/api/onboarding/webhook-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: 'HOSxP webhook_setting auto-provision' }),
          });
          if (!res.ok) {
            const err = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(err?.error ?? `failed to mint key (HTTP ${res.status})`);
          }
          const payload = (await res.json()) as {
            alreadyExists?: unknown;
            apiKey?: unknown;
            keyPrefix?: unknown;
          };
          if (payload.alreadyExists === true) {
            const prefix = typeof payload.keyPrefix === 'string' ? payload.keyPrefix : null;
            traceStep('already_provisioned', { hcode, keyPrefix: prefix });
            publish({ ran: true, alreadyExisted: true });
            writeDone(hcode);
            return;
          }
          if (typeof payload.apiKey !== 'string' || typeof payload.keyPrefix !== 'string') {
            throw new Error('webhook-key response missing apiKey/keyPrefix');
          }
          minted = { apiKey: payload.apiKey, keyPrefix: payload.keyPrefix };
          traceStep('minted_key', { hcode, keyPrefix: minted.keyPrefix });
          // Persist immediately so a crash between here and restInsert
          // lets the next attempt reuse this exact key.
          writePending(hcode, minted);
        }

        // Step 2 — look up the HOSxP webhook_setting row (if any) so we can
        // decide UPDATE vs INSERT. Selecting the PK directly lets us pass it
        // straight into restUpdate without another round-trip.
        const check = await executeSql<{ webhook_setting_id: number }>(
          `SELECT webhook_setting_id FROM webhook_setting
           WHERE webhook_module_id = :moduleId
             AND webhook_setting_code = :settingCode
           LIMIT 1`,
          config,
          { moduleId: WEBHOOK_MODULE_ID, settingCode: WEBHOOK_SETTING_CODE },
          marketplaceToken,
        );
        const existingRow = check?.data?.[0] ?? null;
        const existingId = existingRow ? Number(existingRow.webhook_setting_id) : null;
        traceStep('check_existing_result', {
          hcode,
          existingId,
          hasExistingRow: existingId !== null,
        });

        const webhookUrl = resolveKkLrmsWebhookUrl();

        // PUT for update, POST for insert. BMS's /api/rest accepts writes on
        // webhook_setting now, but POST is a strict INSERT — posting an
        // existing PK returns "#23000 Duplicate entry". PUT /api/rest/{table}/{id}
        // is the correct verb for updating a known row; the body omits the PK
        // since it's in the URL.
        let webhookSettingId: number;
        if (existingId !== null) {
          webhookSettingId = existingId;
          await restUpdate(
            'webhook_setting',
            webhookSettingId,
            {
              webhook_module_id: WEBHOOK_MODULE_ID,
              webhook_setting_code: WEBHOOK_SETTING_CODE,
              webhook_authorization_key: minted.apiKey,
              webhook_url: webhookUrl,
            },
            config,
            marketplaceToken,
          );
        } else {
          // Mint a serial and verify it doesn't collide with an existing
          // webhook_setting row. HOSxP's get_serialnumber counter can drift
          // behind the live table (manual inserts, restores) and return a
          // value that already exists, which would produce the same
          // "#23000 Duplicate entry" BMS error. Retry up to 5 times; if all
          // minted ids collide, fail loudly rather than silently loop.
          webhookSettingId = 0;
          for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = await mintSerial(
              config,
              'webhook_setting',
              'webhook_setting_id',
            );
            const collision = await executeSql<{ n: number }>(
              `SELECT COUNT(*) AS n FROM webhook_setting
               WHERE webhook_setting_id = :id`,
              config,
              { id: candidate },
              marketplaceToken,
            );
            if (Number(collision?.data?.[0]?.n ?? 0) === 0) {
              webhookSettingId = candidate;
              break;
            }
          }
          if (webhookSettingId === 0) {
            throw new Error(
              'get_serialnumber kept returning colliding webhook_setting_id after 5 attempts',
            );
          }
          await restInsert(
            'webhook_setting',
            {
              webhook_setting_id: webhookSettingId,
              webhook_module_id: WEBHOOK_MODULE_ID,
              webhook_setting_code: WEBHOOK_SETTING_CODE,
              webhook_authorization_key: minted.apiKey,
              webhook_url: webhookUrl,
            },
            config,
            marketplaceToken,
          );
        }
        traceStep(existingId !== null ? 'remote_updated' : 'remote_inserted', {
          hcode,
          webhookSettingId,
          keyPrefix: minted.keyPrefix,
          webhookUrl,
        });

        // Stamp the local row so the next reuse-check knows this key was
        // actually accepted by HOSxP. Without this, a successful push still
        // looks identical to a failed push (both produce an active local
        // row), and subsequent visits would re-mint unnecessarily.
        void fetch('/api/onboarding/confirm-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyPrefix: minted.keyPrefix }),
          keepalive: true,
        }).catch(() => undefined);

        publish({
          ran: true,
          alreadyExisted: false,
          createdKeyPrefix: minted.keyPrefix,
        });
        clearPending(hcode);
        writeDone(hcode);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Surface the failure in the console AND in UI state so the
        // dashboard can render a banner. Retry allowed on next mount
        // (ranRef reset); any minted key is cached in sessionStorage so
        // we don't spin up duplicates on repeated failures.
        console.warn('[onboarding] HOSxP webhook_setting provision failed:', message);
        traceStep('failed', { hcode, message });
        ranRef.current = false;
        publish({ ran: true, error: message });
      }
    })();
  }, [config, userInfo, marketplaceToken, isReady]);

  return { state };
}
