// T089: Login page — BMS Session ID authentication (Dark Authority design)
'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Building2, Activity, BarChart3, Shield, Clock, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { withBasePath } from '@/lib/base-path';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MIN_BMS_API_VERSION } from '@/lib/bms-version';
import {
  getSessionCookie,
  setSessionCookie,
  setMarketplaceToken,
} from '@/utils/bms-session-storage';

interface AccessDeniedInfo {
  reason: 'not_registered' | 'deactivated';
  hospitalCode: string;
  hospitalName: string;
  message: string;
}

interface VersionRejection {
  hospitalCode: string;
  hospitalName: string;
  currentVersion: string | null;
  minVersion: string;
  message: string;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState<AccessDeniedInfo | null>(null);
  const [versionRejection, setVersionRejection] = useState<VersionRejection | null>(null);
  const [loading, setLoading] = useState(false);
  const autoLoginAttempted = useRef(false);

  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const bmsSessionId = searchParams.get('bms-session-id');
  const providerError = searchParams.get('providerError');
  const marketplaceToken =
    searchParams.get('marketplace_token') ?? searchParams.get('marketplace-token');

  // Auto-login from the URL param when present, otherwise fall back to the
  // persisted bms-session-id cookie (7-day expiry, written on the last
  // successful login). The NextAuth app session lasts only 8h
  // (auth.config.ts), so a returning user whose app session has lapsed lands
  // here WITHOUT the URL param — but their BMS session cookie is usually still
  // valid. Reusing it re-logs them in silently instead of forcing a re-type.
  // If the cookied session has expired on HOSxP, preflight fails and the
  // manual form is shown (no regression), so the fallback is always safe.
  // Logout clears this cookie (TopNavBar.handleLogout), so it can't defeat
  // an intentional sign-out.
  useEffect(() => {
    if (autoLoginAttempted.current) return;
    const candidate = bmsSessionId ?? getSessionCookie();
    if (candidate) {
      autoLoginAttempted.current = true;
      setSessionId(candidate);
      doLogin(candidate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bmsSessionId]);

  async function doLogin(id: string) {
    setLoading(true);
    setError(null);
    setAccessDenied(null);
    setVersionRejection(null);

    try {
      const trimmed = id.trim();

      // Preflight: differentiate "bad session" from "hospital not registered"
      // BEFORE NextAuth swallows the rejection reason into a generic
      // CredentialsSignin error. The endpoint is public (no auth needed).
      const preflightRes = await fetch(withBasePath('/api/auth/hospital-preflight'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: trimmed }),
      });
      const preflight = (await preflightRes.json().catch(() => null)) as
        | {
            ok: boolean;
            reason?:
              | 'invalid_session'
              | 'not_registered'
              | 'deactivated'
              | 'invalid_request'
              | 'hosxp_too_old';
            hospitalCode?: string;
            hospitalName?: string;
            currentVersion?: string;
            minVersion?: string;
            message?: string;
          }
        | null;

      if (!preflight) {
        setError('ไม่สามารถตรวจสอบ session ได้ — กรุณาลองใหม่');
        return;
      }

      if (!preflight.ok) {
        if (preflight.reason === 'not_registered' || preflight.reason === 'deactivated') {
          setAccessDenied({
            reason: preflight.reason,
            hospitalCode: preflight.hospitalCode ?? '',
            hospitalName: preflight.hospitalName ?? '',
            message: preflight.message ?? '',
          });
        } else if (preflight.reason === 'hosxp_too_old') {
          // Modal blocks access until the user dismisses it; the inline
          // error keeps the message visible after dismissal so support
          // staff reviewing a screenshot can still see why login failed.
          const minVersion = preflight.minVersion ?? MIN_BMS_API_VERSION;
          const detail =
            preflight.message ??
            `กรุณาอัปเดต HOSxP เป็นเวอร์ชัน ${minVersion} ขึ้นไปก่อนเข้าใช้งาน`;
          setVersionRejection({
            hospitalCode: preflight.hospitalCode ?? '',
            hospitalName: preflight.hospitalName ?? '',
            currentVersion: preflight.currentVersion ?? null,
            minVersion,
            message: detail,
          });
          setError(detail);
        } else {
          setError(preflight.message ?? 'Session ID ไม่ถูกต้องหรือหมดอายุ');
        }
        return;
      }

      const result = await signIn('credentials', {
        sessionId: trimmed,
        redirect: false,
      });

      if (result?.error) {
        // Should be rare — preflight passed but signIn failed (race condition
        // where hospital was deactivated between preflight and signIn, or BMS
        // session expired in the same window).
        setError('Session ID ไม่ถูกต้องหรือหมดอายุ');
      } else {
        // Persist the BMS session + marketplace token so BmsSessionProvider
        // (in the hospital layout) can hydrate on the next page. The middleware
        // strips bms-session-id from the callbackUrl, so the cookie is the
        // only surviving channel.
        setSessionCookie(trimmed);
        if (marketplaceToken) setMarketplaceToken(marketplaceToken);
        window.localStorage.setItem('kk-lrms:auth-provider', 'bms');
        router.push(callbackUrl);
      }
    } catch {
      setError('เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId.trim()) {
      setError('กรุณากรอก BMS Session ID');
      return;
    }
    doLogin(sessionId);
  };

  const handleProviderLogin = () => {
    window.location.href = withBasePath(
      `/api/auth/provider/start?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* Left Panel — hidden on mobile */}
      <div className="hidden md:flex md:w-1/2 lg:w-[45%] relative flex-col justify-between bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-10 text-white overflow-hidden">
        {/* Subtle pattern overlay */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Content (above overlay) */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 rounded-xl p-3">
              <Building2 className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">SR-LRMS</h1>
              <p className="text-sm text-slate-400">Surin Labor Room Monitoring System</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 space-y-8">
          <h2 className="text-3xl font-bold text-white leading-tight">
            ระบบติดตาม
            <br />
            การคลอด
            <br />
            จังหวัดสุรินทร์
          </h2>

          <div className="space-y-3">
            <div className="flex items-center gap-4 bg-white/5 rounded-xl p-4">
              <Building2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <span className="text-sm text-slate-300">26 โรงพยาบาลในเครือข่าย</span>
            </div>
            <div className="flex items-center gap-4 bg-white/5 rounded-xl p-4">
              <Activity className="h-5 w-5 shrink-0 text-emerald-400" />
              <span className="text-sm text-slate-300">CPD Score คำนวณอัตโนมัติ</span>
            </div>
            <div className="flex items-center gap-4 bg-white/5 rounded-xl p-4">
              <BarChart3 className="h-5 w-5 shrink-0 text-emerald-400" />
              <span className="text-sm text-slate-300">Partogram ติดตามความก้าวหน้าการคลอด</span>
            </div>
            <div className="flex items-center gap-4 bg-white/5 rounded-xl p-4">
              <Clock className="h-5 w-5 shrink-0 text-emerald-400" />
              <span className="text-sm text-slate-300">Real-time Dashboard ทุกโรงพยาบาล</span>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-xs text-slate-500">
          v1.0.0 — สำนักงานสาธารณสุขจังหวัดสุรินทร์
        </p>
      </div>

      {/* Right Panel — login form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-slate-50 md:bg-white px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile header — shown only on small screens */}
          <div className="md:hidden">
            <div className="bg-slate-900 rounded-2xl p-6 mb-8 text-center">
              <div className="flex justify-center mb-3">
                <div className="bg-white/10 rounded-xl p-3">
                  <Building2 className="h-6 w-6 text-white" />
                </div>
              </div>
              <h1 className="text-lg font-bold text-white">SR-LRMS</h1>
              <p className="text-sm text-slate-400">ระบบติดตามการคลอดจังหวัดสุรินทร์</p>
            </div>
          </div>

          {/* Desktop header — hidden on mobile */}
          <div className="hidden md:block">
            <h2 className="text-3xl font-bold text-slate-900">เข้าสู่ระบบ</h2>
            <p className="mt-2 text-sm text-slate-400">
              ลงชื่อเข้าใช้ด้วย BMS Session ID
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="sessionId"
                className="text-xs font-semibold uppercase tracking-wider text-slate-400"
              >
                BMS Session ID
              </label>
              <Input
                id="sessionId"
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder="กรอก Session ID จาก BMS"
                disabled={loading}
                autoFocus
                className="h-12 rounded-xl border-slate-200 focus-visible:ring-emerald-500 focus-visible:border-emerald-500 bg-slate-50 font-mono"
              />
            </div>

            {accessDenied && (
              <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm">
                <div className="flex items-start gap-2 mb-2">
                  <Shield className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
                  <div className="text-red-800 font-semibold">
                    {accessDenied.reason === 'deactivated'
                      ? 'โรงพยาบาลถูกปิดการใช้งาน'
                      : 'ไม่ได้รับสิทธิ์ใช้งานระบบ'}
                  </div>
                </div>
                <div className="text-red-700 text-xs mb-2">
                  <div>
                    โรงพยาบาล: <span className="font-semibold">{accessDenied.hospitalName || '—'}</span>
                  </div>
                  <div>
                    รหัสโรงพยาบาล: <span className="font-mono font-semibold">{accessDenied.hospitalCode || '—'}</span>
                  </div>
                </div>
                <div className="text-red-700 text-xs leading-relaxed border-t border-red-200 pt-2">
                  {accessDenied.reason === 'deactivated'
                    ? 'โรงพยาบาลของท่านถูกปิดการใช้งานในระบบ SR-LRMS หากท่านคิดว่าเป็นความผิดพลาด กรุณาติดต่อผู้ดูแลระบบ (สสจ.สุรินทร์) เพื่อขอเปิดใช้งานอีกครั้ง'
                    : 'โรงพยาบาลของท่านยังไม่ได้รับการลงทะเบียนในระบบ SR-LRMS หากท่านคิดว่าเป็นความผิดพลาด หรือต้องการเข้าร่วมเครือข่าย กรุณาติดต่อผู้ดูแลระบบ (สสจ.สุรินทร์) เพื่อขอลงทะเบียนโรงพยาบาลของท่านในระบบ'}
                </div>
              </div>
            )}

            {(error || providerError) && !accessDenied && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {error ?? providerError}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  กำลังตรวจสอบ...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  เข้าสู่ระบบ
                </span>
              )}
            </Button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-slate-400">หรือ</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full h-12 rounded-xl border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-semibold"
              disabled={loading}
              onClick={handleProviderLogin}
            >
              <span className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                ProviderID (อ่านอย่างเดียว)
              </span>
            </Button>
          </form>

          <div className="text-center space-y-2">
            <p className="text-xs text-slate-400">
              ระบบตรวจสอบสิทธิ์ผ่าน BMS Session ของ สสจ.สุรินทร์
            </p>
            <a
              href="/about"
              className="inline-block text-sm text-slate-400 hover:text-teal-600 transition-colors"
            >
              เกี่ยวกับระบบ SR-LRMS
            </a>
          </div>
        </div>
      </div>

      <Dialog
        open={versionRejection !== null}
        onOpenChange={(open) => {
          if (!open) setVersionRejection(null);
        }}
      >
        <DialogContent className="sm:max-w-md p-0 overflow-hidden" showCloseButton={false}>
          <div className="bg-gradient-to-br from-red-50 to-orange-50 px-6 pt-6 pb-5 border-b border-red-100">
            <div className="flex items-start gap-4">
              <div className="shrink-0 rounded-full bg-red-100 p-2.5 ring-4 ring-red-50">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogHeader>
                  <DialogTitle className="text-base font-semibold text-red-900">
                    ต้องอัปเดต HOSxP ก่อนใช้งาน
                  </DialogTitle>
                  <DialogDescription className="text-xs text-red-700/80 mt-1">
                    เวอร์ชัน HOSxP API ของโรงพยาบาลเก่ากว่าที่ระบบ SR-LRMS รองรับ
                  </DialogDescription>
                </DialogHeader>
              </div>
            </div>
          </div>

          {versionRejection && (
            <div className="px-6 py-5 space-y-4">
              {(versionRejection.hospitalName || versionRejection.hospitalCode) && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    โรงพยาบาล
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-slate-800 truncate">
                    {versionRejection.hospitalName || '—'}
                  </div>
                  {versionRejection.hospitalCode && (
                    <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                      รหัส {versionRejection.hospitalCode}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-red-500">
                    เวอร์ชันปัจจุบัน
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-red-700">
                    {versionRejection.currentVersion ?? '—'}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                    ต้องการอย่างน้อย
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-emerald-700">
                    {versionRejection.minVersion}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
                กรุณาติดต่อผู้ดูแลระบบ HOSxP ของโรงพยาบาลเพื่ออัปเดต HOSxP เป็นเวอร์ชัน
                {' '}
                <span className="font-mono font-semibold">{versionRejection.minVersion}</span>
                {' '}
                ขึ้นไป จากนั้นจึงเข้าใช้งาน SR-LRMS อีกครั้ง
              </div>
            </div>
          )}

          <DialogFooter className="px-4 py-3">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => setVersionRejection(null)}
            >
              ปิด
            </Button>
            <Button
              type="button"
              className="rounded-lg bg-slate-900 hover:bg-slate-800 text-white"
              onClick={() => setVersionRejection(null)}
            >
              รับทราบ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
