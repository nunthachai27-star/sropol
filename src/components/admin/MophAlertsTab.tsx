// MophAlertsTab — manage province center-monitor recipients for MOPH Prompt
// (LINE) alerts. Codex UI-placement rec: a dedicated top-level admin tab,
// province = scope (derived from the deployment's active_province_code).
//
// Mirrors the ConsultDoctorsSection interaction pattern (CID 13-digit
// validation, add/edit/delete, active toggle) but province-scoped instead of
// hospital-scoped. DELETE soft-deletes (is_active=false) via the API.
'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Bell, Plus, Trash2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';

interface CenterMonitor {
  id: string;
  province: string;
  cid: string;
  name: string;
  position: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ConfigResponse {
  config: { active_province_code?: string | null };
}

const EMPTY_FORM = { id: '', cid: '', name: '', position: '', isActive: true };

function maskCid(cid: string): string {
  return cid.length >= 4 ? `********${cid.slice(-4)}` : '****';
}

export function MophAlertsTab() {
  // 1. Resolve the deployment's active province (codex: default active-province-only).
  const {
    data: configData,
    isLoading: configLoading,
    error: configError,
  } = useSWR<ConfigResponse>('/api/admin/config');
  const provinceCode = configData?.config?.active_province_code ?? '';

  // 2. List center monitors for that province.
  const { data, isLoading, error, mutate } = useSWR<{ monitors: CenterMonitor[] }>(
    provinceCode ? `/api/admin/provinces/${provinceCode}/center-monitors` : null,
  );

  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const monitors = data?.monitors ?? [];
  const editing = !!form.id;
  const activeCount = monitors.filter((m) => m.isActive).length;

  const setField = (key: keyof typeof EMPTY_FORM, value: string | boolean) => {
    setForm((c) => ({ ...c, [key]: value }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setMessage(null);
  };

  const startEdit = (m: CenterMonitor) => {
    setForm({
      id: m.id,
      cid: m.cid,
      name: m.name,
      position: m.position ?? '',
      isActive: m.isActive,
    });
    setMessage(null);
  };

  const handleSave = async () => {
    if (!provinceCode) return;
    setBusy(true);
    setMessage(null);
    try {
      const cid = form.cid.trim();
      const name = form.name.trim();
      if (!/^\d{13}$/.test(cid)) {
        throw new Error('CID ต้องเป็นตัวเลข 13 หลัก');
      }
      if (!name) {
        throw new Error('กรุณาระบุชื่อผู้รับเตือน');
      }

      const path = editing
        ? `/api/admin/provinces/${provinceCode}/center-monitors/${form.id}`
        : `/api/admin/provinces/${provinceCode}/center-monitors`;
      const res = await fetch(path, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cid,
          name,
          position: form.position.trim() || null,
          isActive: form.isActive,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'บันทึกไม่สำเร็จ');
      }

      await mutate();
      setForm(EMPTY_FORM);
      setMessage({
        tone: 'ok',
        text: editing ? 'แก้ไขผู้รับเตือนสำเร็จ' : 'เพิ่มผู้รับเตือนสำเร็จ',
      });
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (m: CenterMonitor) => {
    if (!provinceCode) return;
    if (!confirm(`ลบผู้รับเตือน ${m.name}? (จะปิดการใช้งาน — ไม่ลบข้อมูล)`)) return;
    setDeleteBusyId(m.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/provinces/${provinceCode}/center-monitors/${m.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'ลบไม่สำเร็จ');
      }
      if (form.id === m.id) setForm(EMPTY_FORM);
      await mutate();
      setMessage({ tone: 'ok', text: 'ลบผู้รับเตือนสำเร็จ' });
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setDeleteBusyId(null);
    }
  };

  if (configLoading) return <LoadingState message="กำลังโหลดจังหวัดหลัก..." />;
  if (configError) return <ErrorState message="โหลดจังหวัดหลักไม่สำเร็จ" />;
  if (!provinceCode) {
    return (
      <ErrorState message="ยังไม่ได้ตั้งจังหวัดหลัก — กรุณาตั้งในแท็บ 'จังหวัดหลัก' ก่อนเพิ่มผู้รับเตือน" />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <Bell className="h-4 w-4 text-[var(--accent-navy)]" />
        <h2 className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--ink-navy)' }}>
          ผู้รับการแจ้งเตือน MOPH Prompt (ศูนย์กลางจังหวัด)
        </h2>
        <span className="font-mono text-[11px] text-[var(--ink-navy-muted)]">
          จังหวัด {provinceCode} · {activeCount} ใช้งาน · {monitors.length - activeCount} ปิด
        </span>
      </div>
      <p className="font-mono text-[11px] text-[var(--ink-navy-muted)]">
        ผู้รับเหล่านี้จะได้รับแจ้งเตือน LINE เมื่อมีกรณีเสี่ยงสูง/ฉุกเฉินจากโรงพยาบาลใดๆ ในจังหวัด
      </p>

      {message && (
        <div
          className="font-mono text-[12px] px-3 py-2"
          style={{
            color: message.tone === 'ok' ? 'var(--accent-navy)' : '#dc2626',
            background: message.tone === 'ok' ? 'var(--accent-navy-soft)' : '#fef2f2',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Add/Edit form */}
      <div className="border p-4 space-y-3" style={{ borderColor: 'var(--rule-strong)' }}>
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]">
          {editing ? 'แก้ไขผู้รับเตือน' : 'เพิ่มผู้รับเตือนใหม่'}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="font-mono text-[11px] text-[var(--ink-navy-muted)]">
              CID (13 หลัก)
            </span>
            <Input
              value={form.cid}
              onChange={(e) => setField('cid', e.target.value.replace(/\D/g, '').slice(0, 13))}
              placeholder="เลขบัตรประชาชน 13 หลัก"
              inputMode="numeric"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] text-[var(--ink-navy-muted)]">ชื่อ</span>
            <Input
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="ชื่อผู้รับการแจ้งเตือน"
            />
          </label>
          <label className="space-y-1">
            <span className="font-mono text-[11px] text-[var(--ink-navy-muted)]">ตำแหน่ง</span>
            <Input
              value={form.position}
              onChange={(e) => setField('position', e.target.value)}
              placeholder="ตำแหน่ง (ไม่บังคับ)"
            />
          </label>
          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setField('isActive', e.target.checked)}
              className="h-4 w-4"
            />
            <span className="font-mono text-[11px] text-[var(--ink-navy-muted)]">ใช้งาน</span>
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={busy || !form.cid.trim() || !form.name.trim()}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {busy ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'เพิ่มผู้รับเตือน'}
          </Button>
          {editing && (
            <Button variant="outline" onClick={resetForm} className="gap-1.5">
              <X className="h-3.5 w-3.5" />
              ยกเลิกแก้ไข
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <LoadingState message="กำลังโหลดผู้รับเตือน..." />
      ) : error ? (
        <ErrorState message="โหลดผู้รับเตือนไม่สำเร็จ" />
      ) : monitors.length === 0 ? (
        <div className="font-mono text-[12px] text-[var(--ink-navy-muted)] py-6 text-center">
          ยังไม่มีผู้รับเตือน — เพิ่มด้านบน
        </div>
      ) : (
        <div className="border" style={{ borderColor: 'var(--rule-strong)' }}>
          <div
            className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]"
            style={{ borderBottom: '1px solid var(--rule-strong)' }}
          >
            <div>ชื่อ</div>
            <div>CID</div>
            <div>ตำแหน่ง</div>
            <div>สถานะ</div>
            <div>จัดการ</div>
          </div>
          {monitors.map((m) => (
            <div
              key={m.id}
              className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 px-3 py-2 items-center"
              style={{ borderBottom: '1px solid var(--rule)' }}
            >
              <div className="text-[13px]" style={{ color: 'var(--ink-navy)' }}>
                {m.name}
              </div>
              <code className="font-mono text-[12px] text-[var(--ink-navy-dim)]">
                {maskCid(m.cid)}
              </code>
              <div className="text-[12px] text-[var(--ink-navy-muted)]">{m.position ?? '—'}</div>
              <div>
                {m.isActive ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <X className="h-3.5 w-3.5 text-[var(--ink-navy-muted)]" />
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startEdit(m)}
                  disabled={busy || !!deleteBusyId}
                  className="h-7 px-2 text-[11px]"
                >
                  แก้ไข
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(m)}
                  disabled={busy || deleteBusyId === m.id}
                  className="h-7 px-2 text-[11px]"
                >
                  {deleteBusyId === m.id ? '...' : <Trash2 className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
