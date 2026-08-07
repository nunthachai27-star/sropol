'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Building2, Loader2, Shield, UserRound } from 'lucide-react';
import { removeMarketplaceToken, removeSessionCookie } from '@/utils/bms-session-storage';
import { sanitizeCallbackUrl } from '@/lib/safe-callback-url';

interface ProviderOrgSummary {
  index: number;
  hcode: string;
  hnameTh: string;
  hnameEng: string;
  position: string;
  affiliation: string;
  province?: string;
  district?: string;
  isDirector: boolean;
  isHrAdmin: boolean;
}

interface ProviderPendingSummary {
  user: {
    nameTh: string;
    titleTh: string;
    providerId: string;
  };
  organizations: ProviderOrgSummary[];
}

function ProviderCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const callbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'));
  const [summary, setSummary] = useState<ProviderPendingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSignInRef = useRef(false);

  const title = useMemo(() => {
    const user = summary?.user;
    if (!user) return '';
    return `${user.titleTh ?? ''}${user.nameTh ?? ''}`.trim();
  }, [summary]);

  const completeSignIn = useCallback(
    async (organizationIndex: number) => {
      if (!token || signingIn) return;
      setSigningIn(true);
      setError(null);
      removeSessionCookie();
      removeMarketplaceToken();
      window.localStorage.setItem('kk-lrms:auth-provider', 'provider-id');

      // Keep the spinner up during the success navigation; only the failure
      // paths below unwind `signingIn` (via the finally block).
      let navigating = false;
      try {
        const result = await signIn('provider-id', {
          token,
          organizationIndex: String(organizationIndex),
          redirect: false,
        });

        if (result?.error) {
          // Preflight already validated the token, so this is rare. Keep the
          // Thai headline but surface the raw NextAuth error code so support
          // can distinguish causes (CredentialsSignin, Configuration, etc.).
          setError(`ไม่สามารถเข้าสู่ระบบด้วย ProviderID ได้ (${result.error})`);
          return;
        }

        navigating = true;
        router.replace(callbackUrl);
      } catch (err) {
        // A thrown network/CSRF error previously left signingIn=true forever
        // (stuck spinner). Log it and show an actionable Thai message.
        console.error('[provider-complete] signIn failed', err);
        const detail = err instanceof Error ? err.message : String(err);
        setError(`ไม่สามารถเข้าสู่ระบบด้วย ProviderID ได้ กรุณาลองใหม่อีกครั้ง (${detail})`);
      } finally {
        if (!navigating) setSigningIn(false);
      }
    },
    [callbackUrl, router, signingIn, token],
  );

  useEffect(() => {
    if (!token) {
      router.replace('/login?providerError=missing_provider_token');
      return;
    }

    let cancelled = false;
    async function loadSummary() {
      try {
        const response = await fetch(
          `/api/auth/provider/pending?token=${encodeURIComponent(token)}`,
        );
        if (!response.ok) {
          throw new Error('ProviderID session expired');
        }
        const payload = (await response.json()) as ProviderPendingSummary;
        if (!cancelled) setSummary(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'ProviderID session expired');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [router, token]);

  useEffect(() => {
    if (!summary || loading || autoSignInRef.current) return;
    if (summary.organizations.length === 1) {
      autoSignInRef.current = true;
      void completeSignIn(summary.organizations[0].index);
    }
  }, [completeSignIn, loading, summary]);

  if (loading || signingIn || (summary?.organizations.length === 1 && !error)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-slate-800" />
          <div>
            <h1 className="text-lg font-semibold text-slate-900">กำลังเข้าสู่ระบบ ProviderID</h1>
            <p className="mt-1 text-sm text-slate-500">ระบบจะเปิดใช้งานในโหมดอ่านอย่างเดียว</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-6 text-center shadow-sm">
          <Shield className="mx-auto h-10 w-10 text-red-500" />
          <h1 className="mt-4 text-lg font-semibold text-slate-900">
            เข้าสู่ระบบ ProviderID ไม่สำเร็จ
          </h1>
          <p className="mt-2 text-sm text-red-600">{error ?? 'ไม่พบข้อมูลการเข้าสู่ระบบ'}</p>
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            กลับหน้าเข้าสู่ระบบ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-slate-900 text-white">
            <UserRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">เลือกหน่วยงาน ProviderID</h1>
            <p className="text-sm text-slate-500">
              {title || 'ProviderID'} · {summary.user.providerId}
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {summary.organizations.map((org) => (
            <button
              key={`${org.hcode}:${org.index}`}
              type="button"
              onClick={() => void completeSignIn(org.index)}
              disabled={signingIn}
              className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60"
            >
              <div className="flex items-start gap-3">
                <Building2 className="mt-1 h-5 w-5 shrink-0 text-slate-500" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">{org.hnameTh || org.hnameEng}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {org.hcode} · {org.position || 'ไม่ระบุตำแหน่ง'}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {[org.district, org.province, org.affiliation].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  อ่านอย่างเดียว
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProviderCompletePage() {
  return (
    <Suspense>
      <ProviderCompleteContent />
    </Suspense>
  );
}
