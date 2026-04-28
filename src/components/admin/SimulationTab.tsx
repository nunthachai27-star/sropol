// SimulationTab — admin panel wrapper around the existing SimulationControl
// so the dev-simulation launcher lives under /admin instead of the dashboard
// header. The control renders a trigger button + dialog; the tab adds the
// surrounding explanation copy so non-developer admins understand the scope
// and destructive side-effects before clicking.
'use client';

import { FlaskConical, AlertTriangle } from 'lucide-react';
import { SimulationControl } from '@/components/dashboard/SimulationControl';

export function SimulationTab() {
  return (
    <div className="space-y-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
        DEV SIMULATION
      </div>

      <div
        className="border bg-white p-4"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <div className="flex items-start gap-3">
          <FlaskConical className="h-5 w-5" style={{ color: '#b45309' }} />
          <div className="flex-1">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-navy)' }}>
              จำลองข้อมูลผู้ป่วย (Dev Simulation)
            </h3>
            <p className="mt-0.5 text-[12px] leading-snug text-[var(--ink-navy-dim)]">
              สร้างเหตุการณ์สังเคราะห์ (การรับผู้ป่วย · ANC · referral · partograph)
              ลงใน local DB ด้วย Gemma-4 เพื่อใช้ทดสอบทุก surface ของแดชบอร์ด —
              ทุก event type · preset scenario ครบทุกโหมด · และเลือกโรงพยาบาลเองได้
            </p>

            <div
              className="mt-3 flex items-start gap-2 border px-3 py-2 text-[12px] leading-snug"
              style={{
                borderColor: 'var(--risk-medium)',
                background: 'color-mix(in srgb, var(--risk-medium) 8%, white)',
                color: 'var(--ink-navy-dim)',
              }}
            >
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ color: 'var(--risk-medium)' }}
              />
              <div>
                <strong className="font-semibold" style={{ color: 'var(--ink-navy)' }}>
                  คำเตือน
                </strong>{' '}
                · ข้อมูลที่สร้างจะเขียนจริงลงในตาราง cache ของ kk-lrms และแสดงในแดชบอร์ด
                · ใช้กับ DB ทดสอบเท่านั้น · API /api/dev/simulate
                จะถูกบล็อกโดยเซิร์ฟเวอร์เมื่อ DEV_SIMULATION_ENABLED ไม่ได้เปิดไว้
              </div>
            </div>

            <div className="mt-4">
              <SimulationControl />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
