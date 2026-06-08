// ActiveProvinceTab — single-select for the deployment's main focus province.
// Switching the active province reshapes which hospitals/patients the
// dashboard and sync jobs see. Designed to match BmsConfigTab's flat navy
// aesthetic: mono-label header, single bordered panel, explicit save CTA.
'use client';

import { useEffect, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { withBasePath } from '@/lib/base-path';
import { Globe, Save, CheckCircle2, ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/shared/LoadingState';
import { BulkAddHospitalsDialog } from './BulkAddHospitalsDialog';

interface ProvinceRow {
  code: string;
  name: string;
}

interface ConfigResponse {
  config: { active_province_code?: string | null };
}

export function ActiveProvinceTab() {
  const { data: provincesData, isLoading: pLoading } = useSWR<{ provinces: ProvinceRow[] }>(
    '/api/admin/provinces',
  );
  const {
    data: configData,
    isLoading: cLoading,
    mutate,
  } = useSWR<ConfigResponse>('/api/admin/config');

  const [selectedCode, setSelectedCode] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { mutate: globalMutate } = useSWRConfig();

  useEffect(() => {
    if (configData?.config?.active_province_code) {
      setSelectedCode(configData.config.active_province_code);
    }
  }, [configData]);

  if (pLoading || cLoading) {
    return <LoadingState message="กำลังโหลดรายการจังหวัด..." />;
  }

  const provinces = provincesData?.provinces ?? [];
  const currentCode = configData?.config?.active_province_code ?? '';
  const currentProvince = provinces.find((p) => p.code === currentCode);
  const changed = selectedCode !== currentCode;

  const handleSave = async () => {
    if (!selectedCode) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(withBasePath('/api/admin/config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeProvinceCode: selectedCode }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'save failed');
      }
      setSaveMessage('บันทึกสำเร็จ');
      await mutate();
    } catch (e) {
      setSaveMessage((e as Error).message ?? 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
        ACTIVE PROVINCE · {provinces.length} choices
      </div>

      <div
        className="border bg-white p-4"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <div className="flex items-start gap-3">
          <Globe className="h-5 w-5" style={{ color: 'var(--accent-navy)' }} />
          <div className="flex-1">
            <h3
              className="text-sm font-semibold"
              style={{ color: 'var(--ink-navy)' }}
            >
              จังหวัดหลักของระบบ
            </h3>
            <p className="mt-0.5 text-[12px] leading-snug text-[var(--ink-navy-dim)]">
              เลือกจังหวัดที่ระบบจะโฟกัส — กระทบแดชบอร์ด แผนที่ และ sync หลังจากบันทึก
              โรงพยาบาลในจังหวัดอื่นจะไม่แสดงจนกว่าจะเพิ่มเข้าระบบ
            </p>

            <div className="mt-3 grid grid-cols-[1fr,auto] gap-3">
              <select
                value={selectedCode}
                onChange={(e) => setSelectedCode(e.target.value)}
                className="h-9 border bg-white px-2 font-mono text-sm"
                style={{
                  borderColor: 'var(--rule-strong)',
                  color: 'var(--ink-navy)',
                }}
              >
                <option value="">— เลือกจังหวัด —</option>
                {provinces.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <Button
                onClick={handleSave}
                disabled={!changed || saving || !selectedCode}
                className="gap-1.5"
              >
                <Save className="h-4 w-4" />
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </div>

            {currentProvince ? (
              <div className="mt-3 inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[11px]"
                style={{
                  borderColor: 'var(--rule-strong)',
                  background: 'var(--accent-navy-soft)',
                  color: 'var(--accent-navy)',
                }}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                กำลังใช้งาน: {currentProvince.name} · {currentProvince.code}
              </div>
            ) : null}

            {saveMessage ? (
              <div className="mt-2 text-[12px]" style={{ color: 'var(--ink-navy-dim)' }}>
                {saveMessage}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bulk-add shortcut — spares admins from opening the Hospitals tab and
          adding one-by-one when bringing a brand new province online. */}
      {currentProvince ? (
        <div
          className="border bg-white p-4"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <div className="flex items-start gap-3">
            <ListPlus className="h-5 w-5" style={{ color: 'var(--accent-navy)' }} />
            <div className="flex-1">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-navy)' }}>
                เพิ่มหลายโรงพยาบาลพร้อมกัน
              </h3>
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--ink-navy-dim)]">
                เลือกโรงพยาบาลในจังหวัด{currentProvince.name}จากทะเบียน MOPH แล้วเพิ่มเข้าระบบในครั้งเดียว
                — ระบบจะตั้งค่า LEVEL และ service_type เริ่มต้นให้อัตโนมัติ
              </p>
              <div className="mt-3">
                <Button onClick={() => setBulkOpen(true)} className="gap-1.5">
                  <ListPlus className="h-4 w-4" />
                  เลือกโรงพยาบาลจากทะเบียน MOPH
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <BulkAddHospitalsDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        provinceCode={currentProvince?.code ?? selectedCode}
        provinceName={currentProvince?.name}
        onAdded={async () => {
          // Revalidate the hospital list so HospitalsTab + AdminMapPane pick
          // up the new rows immediately after the bulk dialog closes.
          await globalMutate('/api/admin/hospitals');
        }}
      />
    </div>
  );
}
