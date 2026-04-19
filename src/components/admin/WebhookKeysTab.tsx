'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { KeyRound, Copy, Check, AlertTriangle, Trash2, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
      const res = await fetch('/api/admin/webhooks', {
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
      // clipboard blocked — show a fallback note inside the banner if needed
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget || revokeInput !== revokeTarget.keyPrefix) return;

    setRevoking(true);
    setRevokeError(null);

    try {
      const res = await fetch(`/api/admin/webhooks/${revokeTarget.id}`, { method: 'DELETE' });
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border-t-4 border-t-teal-500 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">ทั้งหมด</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-800">{keys.length}</div>
          <div className="text-xs text-slate-400">คีย์ทั้งหมด</div>
        </div>
        <div className="rounded-xl border-t-4 border-t-green-500 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">ใช้งานได้</div>
          <div className="mt-1 font-mono text-2xl font-bold text-green-600">{activeCount}</div>
          <div className="text-xs text-slate-400">Active</div>
        </div>
        <div className="rounded-xl border-t-4 border-t-slate-400 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">ยกเลิกแล้ว</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-500">{keys.length - activeCount}</div>
          <div className="text-xs text-slate-400">Revoked</div>
        </div>
      </div>

      <form onSubmit={handleCreate} className="rounded-xl bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-teal-600" />
          <h3 className="text-sm font-semibold text-slate-700">สร้าง API Key ใหม่</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr_auto]">
          <div>
            <label htmlFor="hcode" className="mb-1 block text-xs text-slate-500">โรงพยาบาล</label>
            <select
              id="hcode"
              value={formHcode}
              onChange={(e) => setFormHcode(e.target.value)}
              disabled={creating}
              className="h-9 w-full rounded-lg border border-input bg-white px-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
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
            <label htmlFor="label" className="mb-1 block text-xs text-slate-500">Label</label>
            <Input
              id="label"
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="เช่น Production webhook — Chiang Rai"
              disabled={creating}
              required
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={creating || !formHcode || !formLabel.trim()}
              className="gap-2 bg-teal-600 hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'กำลังสร้าง...' : 'สร้าง Key'}
            </Button>
          </div>
        </div>
        {createError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {createError}
          </div>
        )}
      </form>

      {justCreated && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
              <div>
                <div className="font-semibold text-amber-900">
                  บันทึก API Key นี้ไว้ทันที — ระบบจะไม่แสดงให้เห็นอีก
                </div>
                <div className="mt-1 text-sm text-amber-800">
                  {justCreated.hospitalName} ({justCreated.hcode}) · {justCreated.label}
                </div>
              </div>
            </div>
            <button
              onClick={() => setJustCreated(null)}
              className="rounded-lg p-1 text-amber-700 hover:bg-amber-100"
              title="ปิด"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white p-3">
            <code className="flex-1 overflow-x-auto font-mono text-sm text-slate-800">
              {justCreated.apiKey}
            </code>
            <Button
              onClick={handleCopy}
              variant="outline"
              size="sm"
              className="gap-1.5 border-amber-300 hover:bg-amber-100"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </Button>
          </div>
          <div className="mt-3 text-xs text-amber-700">
            ใช้ค่านี้ในส่วน <code className="rounded bg-amber-100 px-1">Authorization: Bearer &lt;key&gt;</code> เมื่อส่ง webhook
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">โรงพยาบาล</th>
              <th className="px-4 py-3 font-medium">Label</th>
              <th className="px-4 py-3 font-medium">Prefix</th>
              <th className="px-4 py-3 font-medium">สร้างเมื่อ</th>
              <th className="px-4 py-3 font-medium">ใช้ล่าสุด</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium text-right">การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                  ยังไม่มี API Key — สร้างด้านบน
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr
                  key={k.id}
                  className={`border-b last:border-b-0 ${k.isActive ? '' : 'bg-slate-50 opacity-60'}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{k.hospitalName}</div>
                    <div className="font-mono text-xs text-slate-400">{k.hcode}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{k.label}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
                      {k.keyPrefix}…
                    </code>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(k.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {k.lastUsedAt
                      ? formatDateTime(k.lastUsedAt)
                      : <span className="italic text-slate-400">ยังไม่เคยใช้</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    {k.isActive ? (
                      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-500">
                        Revoked
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {k.isActive && (
                      <button
                        onClick={() => setRevokeTarget(k)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        ยกเลิก
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && closeRevokeModal()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              ยืนยันการยกเลิก API Key
            </DialogTitle>
          </DialogHeader>

          {revokeTarget && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div><span className="text-slate-500">โรงพยาบาล:</span> {revokeTarget.hospitalName}</div>
                <div><span className="text-slate-500">Label:</span> {revokeTarget.label}</div>
                <div><span className="text-slate-500">Prefix:</span> <code className="font-mono">{revokeTarget.keyPrefix}</code></div>
              </div>

              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                คีย์ที่ยกเลิกแล้วจะใช้งานไม่ได้ทันที — webhooks จากโรงพยาบาลนี้จะถูกปฏิเสธจนกว่าจะสร้างคีย์ใหม่
              </div>

              <div>
                <label htmlFor="confirmPrefix" className="mb-1 block text-sm font-medium text-slate-700">
                  พิมพ์ <code className="rounded bg-slate-100 px-1 font-mono">{revokeTarget.keyPrefix}</code> เพื่อยืนยัน
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
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
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
