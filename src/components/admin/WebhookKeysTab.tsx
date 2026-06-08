// WebhookKeysTab — manage per-hospital Webhook API keys. Redesigned
// 2026-04-21 to match the dashboard aesthetic: flush KPI strip, mono-bordered
// pills, navy accents, risk-palette "create reveal" banner.
'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { withBasePath } from '@/lib/base-path';
import { KeyRound, Copy, Check, AlertTriangle, Trash2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { LoadingState } from '@/components/shared/LoadingState';

interface WebhookKey {
  id: string;
  hospitalId: string;
  hcode: string;
  hospitalName: string;
  keyPrefix: string;
  label: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface AdminHospital {
  hcode: string;
  name: string;
}

interface JustCreatedKey {
  id: string;
  apiKey: string;
  keyPrefix: string;
  hospitalName: string;
  hcode: string;
  label: string;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('th-TH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function WebhookKeysTab() {
  const { data: keysData, isLoading, mutate } = useSWR<{ keys: WebhookKey[] }>('/api/admin/webhooks');
  const { data: hospitalsData } = useSWR<{ hospitals: AdminHospital[] }>('/api/admin/hospitals');

  const [formHcode, setFormHcode] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<JustCreatedKey | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<WebhookKey | null>(null);
  const [revokeInput, setRevokeInput] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  if (isLoading) {
    return <LoadingState message="กำลังโหลด API Keys..." />;
  }

  const keys = keysData?.keys ?? [];
  const hospitals = hospitalsData?.hospitals ?? [];
  const activeCount = keys.filter((k) => k.isActive).length;

  const handleCreate = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!formHcode || !formLabel.trim()) return;

    setCreating(true);
    setCreateError(null);
    setCopied(false);

    try {
      const res = await fetch(withBasePath('/api/admin/webhooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hcode: formHcode, label: formLabel.trim() }),
      });
      const result = await res.json();

      if (!res.ok) {
        setCreateError(result.error ?? 'สร้าง API Key ไม่สำเร็จ');
        return;
      }

      setJustCreated({
        id: result.id,
        apiKey: result.apiKey,
        keyPrefix: result.keyPrefix,
        hospitalName: result.hospitalName,
        hcode: result.hcode,
        label: result.label,
      });
      setFormHcode('');
      setFormLabel('');
      mutate();
    } catch {
      setCreateError('เกิดข้อผิดพลาดในการสร้าง API Key');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — leave the banner; user can triple-click to select
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget || revokeInput !== revokeTarget.keyPrefix) return;

    setRevoking(true);
    setRevokeError(null);

    try {
      const res = await fetch(withBasePath(`/api/admin/webhooks/${revokeTarget.id}`), { method: 'DELETE' });
      const result = await res.json();

      if (!res.ok) {
        setRevokeError(result.error ?? 'ยกเลิก API Key ไม่สำเร็จ');
        return;
      }

      setRevokeTarget(null);
      setRevokeInput('');
      mutate();
    } catch {
      setRevokeError('เกิดข้อผิดพลาดในการยกเลิก');
    } finally {
      setRevoking(false);
    }
  };

  const closeRevokeModal = () => {
    setRevokeTarget(null);
    setRevokeInput('');
    setRevokeError(null);
  };

  const kpis: Array<{ k: string; v: number; color: string; label: string }> = [
    { k: 'TOTAL', v: keys.length, color: 'var(--accent-navy)', label: 'คีย์ทั้งหมด' },
    { k: 'ACTIVE', v: activeCount, color: 'var(--risk-low)', label: 'ใช้งานได้' },
    { k: 'REVOKED', v: keys.length - activeCount, color: 'var(--ink-navy-muted)', label: 'ยกเลิกแล้ว' },
  ];

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div
        className="grid border bg-white"
        style={{
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          borderColor: 'var(--rule-strong)',
        }}
      >
        {kpis.map((k, i) => (
          <div
            key={k.k}
            className="flex flex-col gap-1 px-4 py-3"
            style={{
              borderLeft: `2px solid ${k.color}`,
              borderRight: i < kpis.length - 1 ? '1px solid var(--rule-strong)' : undefined,
            }}
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-navy-muted)]">
              {k.k}
            </div>
            <div
              className="font-mono text-[28px] font-semibold leading-none tabular-nums"
              style={{ color: k.color, letterSpacing: '-0.02em' }}
            >
              {k.v}
            </div>
            <div className="font-mono text-[10px] text-[var(--ink-navy-dim)]">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Create form */}
      <form
        onSubmit={handleCreate}
        className="border bg-white px-4 py-3"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" style={{ color: 'var(--accent-navy)' }} />
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-navy)]">
            สร้าง API Key ใหม่
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[220px_1fr_auto]">
          <div>
            <label
              htmlFor="hcode"
              className="mb-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]"
            >
              โรงพยาบาล
            </label>
            <select
              id="hcode"
              value={formHcode}
              onChange={(e) => setFormHcode(e.target.value)}
              disabled={creating}
              className="h-8 w-full rounded-sm border bg-white px-2 text-[12px] focus:border-[var(--accent-navy)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-navy-soft)] disabled:opacity-50"
              style={{ borderColor: 'var(--rule-strong)' }}
              required
            >
              <option value="">— เลือก —</option>
              {hospitals.map((h) => (
                <option key={h.hcode} value={h.hcode}>
                  {h.name} ({h.hcode})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="label"
              className="mb-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]"
            >
              Label
            </label>
            <Input
              id="label"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="เช่น Production webhook — Chiang Rai"
              disabled={creating}
              required
              className="h-8 text-[12px]"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={creating || !formHcode || !formLabel.trim()}
              className="h-8 gap-1.5 text-[12px]"
              style={{ background: 'var(--accent-navy)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              {creating ? 'กำลังสร้าง...' : 'สร้าง Key'}
            </Button>
          </div>
        </div>
        {createError && (
          <div
            className="mt-2 border px-2.5 py-1.5 font-mono text-[11px]"
            style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)' }}
          >
            {createError}
          </div>
        )}
      </form>

      {justCreated && (
        <div
          className="border-2 bg-white px-4 py-3"
          style={{ borderColor: 'var(--risk-medium)' }}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                style={{ color: 'var(--risk-medium)' }}
              />
              <div>
                <div
                  className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]"
                  style={{ color: 'var(--risk-medium)' }}
                >
                  บันทึก API Key นี้ไว้ทันที — ระบบจะไม่แสดงให้เห็นอีก
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-[var(--ink-navy-dim)]">
                  {justCreated.hospitalName} ({justCreated.hcode}) · {justCreated.label}
                </div>
              </div>
            </div>
            <button
              onClick={() => setJustCreated(null)}
              className="rounded-sm p-1 text-[var(--ink-navy-muted)] hover:bg-[var(--accent-navy-soft)] hover:text-[var(--accent-navy)]"
              title="ปิด"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div
            className="flex items-center gap-2 border bg-[var(--surface-cool)] px-3 py-2"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            <code className="flex-1 overflow-x-auto font-mono text-[12px] text-[var(--ink-navy)]">
              {justCreated.apiKey}
            </code>
            <Button
              onClick={handleCopy}
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-[11px]"
            >
              {copied ? (
                <Check className="h-3 w-3" style={{ color: 'var(--risk-low)' }} />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </Button>
          </div>
          <div className="mt-2 font-mono text-[10px] tracking-[0.04em] text-[var(--ink-navy-dim)]">
            ใช้ค่านี้ในส่วน{' '}
            <code
              className="rounded-sm border px-1 font-mono text-[10px]"
              style={{ borderColor: 'var(--rule-strong)', background: 'var(--surface-cool)' }}
            >
              Authorization: Bearer &lt;key&gt;
            </code>{' '}
            เมื่อส่ง webhook
          </div>
        </div>
      )}

      {/* Keys table */}
      <div
        className="border bg-white overflow-x-auto"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <div
          className="grid gap-2 border-b px-3 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--ink-navy-muted)]"
          style={{
            gridTemplateColumns: '1fr 1fr 110px 130px 130px 80px 80px',
            borderColor: 'var(--rule-strong)',
          }}
        >
          <div>HOSPITAL</div>
          <div>LABEL</div>
          <div>PREFIX</div>
          <div>CREATED</div>
          <div>LAST USED</div>
          <div>STATUS</div>
          <div className="text-right">ACTION</div>
        </div>
        {keys.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <KeyRound className="mx-auto mb-2 h-8 w-8 text-[var(--ink-navy-muted)] opacity-50" />
            <p className="font-mono text-[11px] text-[var(--ink-navy-muted)]">
              ยังไม่มี API Key — สร้างด้านบน
            </p>
          </div>
        ) : (
          keys.map((k) => (
            <div
              key={k.id}
              className="grid items-center gap-2 border-b px-3 py-2"
              style={{
                gridTemplateColumns: '1fr 1fr 110px 130px 130px 80px 80px',
                borderColor: 'var(--rule-hair)',
                minHeight: 44,
                opacity: k.isActive ? 1 : 0.55,
              }}
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-[var(--ink-navy)]">
                  {k.hospitalName}
                </div>
                <div className="font-mono text-[10px] tabular-nums text-[var(--ink-navy-muted)]">
                  {k.hcode}
                </div>
              </div>
              <div className="truncate text-[12px] text-[var(--ink-navy-dim)]">{k.label}</div>
              <div>
                <code
                  className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-navy-dim)]"
                  style={{ borderColor: 'var(--rule-strong)', background: 'var(--surface-cool)' }}
                >
                  {k.keyPrefix}…
                </code>
              </div>
              <div className="font-mono text-[11px] tabular-nums text-[var(--ink-navy-dim)]">
                {formatDateTime(k.createdAt)}
              </div>
              <div className="font-mono text-[11px] tabular-nums text-[var(--ink-navy-dim)]">
                {k.lastUsedAt ? (
                  formatDateTime(k.lastUsedAt)
                ) : (
                  <span className="italic text-[var(--ink-navy-muted)]">ยังไม่เคยใช้</span>
                )}
              </div>
              <div>
                {k.isActive ? (
                  <span
                    className="inline-block border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em]"
                    style={{ color: 'var(--risk-low)', borderColor: 'var(--risk-low)' }}
                  >
                    ACTIVE
                  </span>
                ) : (
                  <span
                    className="inline-block border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em]"
                    style={{
                      color: 'var(--ink-navy-muted)',
                      borderColor: 'var(--rule-strong)',
                    }}
                  >
                    REVOKED
                  </span>
                )}
              </div>
              <div className="text-right">
                {k.isActive && (
                  <button
                    onClick={() => setRevokeTarget(k)}
                    className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 font-mono text-[10px] transition-colors hover:bg-red-50"
                    style={{ color: 'var(--risk-high)' }}
                  >
                    <Trash2 className="h-3 w-3" />
                    ยกเลิก
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && closeRevokeModal()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" style={{ color: 'var(--risk-high)' }} />
              ยืนยันการยกเลิก API Key
            </DialogTitle>
          </DialogHeader>

          {revokeTarget && (
            <div className="space-y-4">
              <div
                className="space-y-1 border px-3 py-2 font-mono text-[11px]"
                style={{ borderColor: 'var(--rule-strong)', background: 'var(--surface-cool)' }}
              >
                <div>
                  <span className="text-[var(--ink-navy-muted)]">โรงพยาบาล:</span>{' '}
                  {revokeTarget.hospitalName}
                </div>
                <div>
                  <span className="text-[var(--ink-navy-muted)]">Label:</span> {revokeTarget.label}
                </div>
                <div>
                  <span className="text-[var(--ink-navy-muted)]">Prefix:</span>{' '}
                  <code className="font-mono">{revokeTarget.keyPrefix}</code>
                </div>
              </div>

              <div
                className="border px-3 py-2 font-mono text-[11px]"
                style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)' }}
              >
                คีย์ที่ยกเลิกแล้วจะใช้งานไม่ได้ทันที — webhooks จากโรงพยาบาลนี้จะถูกปฏิเสธจนกว่าจะสร้างคีย์ใหม่
              </div>

              <div>
                <label
                  htmlFor="confirmPrefix"
                  className="mb-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-navy-muted)]"
                >
                  พิมพ์{' '}
                  <code
                    className="rounded-sm border px-1 font-mono text-[10px] text-[var(--ink-navy-dim)]"
                    style={{ borderColor: 'var(--rule-strong)', background: 'var(--surface-cool)' }}
                  >
                    {revokeTarget.keyPrefix}
                  </code>{' '}
                  เพื่อยืนยัน
                </label>
                <Input
                  id="confirmPrefix"
                  value={revokeInput}
                  onChange={(e) => setRevokeInput(e.target.value)}
                  placeholder={revokeTarget.keyPrefix}
                  autoComplete="off"
                  disabled={revoking}
                  className="font-mono"
                />
              </div>

              {revokeError && (
                <div
                  className="border px-3 py-2 font-mono text-[11px]"
                  style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)' }}
                >
                  {revokeError}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeRevokeModal} disabled={revoking}>
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={revoking || !revokeTarget || revokeInput !== revokeTarget.keyPrefix}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {revoking ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
