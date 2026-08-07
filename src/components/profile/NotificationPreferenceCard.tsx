// Single MOPH LINE opt-in toggle (spec 2026-08-05). Optimistic with revert on
// error; actionable Thai error (constitution §V).
'use client';
import { useEffect, useState } from 'react';

export function NotificationPreferenceCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/profile/notification-preference')
      .then((r) => {
        if (!r.ok) throw new Error('http');
        return r.json() as Promise<{ mophLineEnabled: boolean }>;
      })
      .then((b) => setEnabled(b.mophLineEnabled))
      .catch(() => setError('โหลดการตั้งค่าไม่สำเร็จ ลองใหม่อีกครั้ง'));
  }, []);

  async function toggle() {
    if (enabled === null || busy) return;
    const previous = enabled;
    const next = !enabled;
    setEnabled(next);
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/profile/notification-preference', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mophLineEnabled: next }),
      });
      if (!res.ok) throw new Error('http');
      const body = (await res.json()) as { mophLineEnabled: boolean };
      setEnabled(body.mophLineEnabled);
    } catch {
      setEnabled(previous); // optimistic revert
      setError('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">รับการแจ้งเตือน MOPH ทาง LINE</p>
          <p className="text-xs text-slate-500">ผู้ป่วยเสี่ยงสูง / ฉุกเฉิน</p>
        </div>
        <button
          role="switch"
          aria-checked={enabled === true}
          disabled={enabled === null || busy}
          onClick={() => void toggle()}
          className={`relative h-7 w-14 rounded-full transition ${enabled ? 'bg-teal-600' : 'bg-slate-300'}`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
              enabled ? 'left-8' : 'left-1'
            }`}
          />
        </button>
      </div>
      {busy && <p className="mt-2 text-xs text-slate-500">กำลังบันทึก…</p>}
      {error && (
        <p className="mt-2 text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
