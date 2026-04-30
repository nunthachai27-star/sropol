// BmsConfigTab — per-hospital BMS tunnel URL configuration. Redesigned
// 2026-04-21 to match the dashboard aesthetic: flush KPI strip, sharp-
// cornered bordered hospital tiles, navy accents.
'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Wifi, WifiOff, Pencil, FlaskConical, Save, Database } from 'lucide-react';
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

interface AdminHospital {
  hcode: string;
  name: string;
  level: string;
  isActive: boolean;
  connectionStatus: string;
  lastSyncAt: string | null;
  bmsConfig: {
    tunnelUrl: string;
    hasSession: boolean;
    sessionExpiresAt: string | null;
    databaseType: string | null;
  } | null;
}

interface TestResult {
  connected: boolean;
  databaseType?: string;
  databaseVersion?: string;
  tablesFound?: string[];
  error?: string;
}

type TunnelStatus = 'ONLINE' | 'CONFIGURED' | 'EXPIRED' | 'NOT_CONFIGURED';

function hasFutureSession(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const time = new Date(expiresAt).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function getTunnelStatus(hospital: AdminHospital): TunnelStatus {
  if (!hospital.bmsConfig?.tunnelUrl) return 'NOT_CONFIGURED';
  if (hospital.bmsConfig.hasSession && hasFutureSession(hospital.bmsConfig.sessionExpiresAt)) {
    return 'ONLINE';
  }
  if (hospital.bmsConfig.sessionExpiresAt && !hasFutureSession(hospital.bmsConfig.sessionExpiresAt)) {
    return 'EXPIRED';
  }
  return 'CONFIGURED';
}

const TUNNEL_STATUS_META: Record<TunnelStatus, {
  label: string;
  color: string;
  Icon: typeof Wifi;
}> = {
  ONLINE: {
    label: 'BMS tunnel online',
    color: 'var(--risk-low)',
    Icon: Wifi,
  },
  CONFIGURED: {
    label: 'URL saved · not validated',
    color: 'var(--risk-medium)',
    Icon: WifiOff,
  },
  EXPIRED: {
    label: 'session expired',
    color: 'var(--risk-high)',
    Icon: WifiOff,
  },
  NOT_CONFIGURED: {
    label: 'ยังไม่ตั้งค่า Tunnel URL',
    color: 'var(--ink-navy-muted)',
    Icon: WifiOff,
  },
};

function formatLastSync(value: string | null) {
  if (!value) return 'LAST SYNC —';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'LAST SYNC —';
  return `LAST SYNC ${date.toLocaleString('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
  })}`;
}

export function BmsConfigTab() {
  const { data, isLoading, mutate } = useSWR<{ hospitals: AdminHospital[] }>('/api/admin/hospitals');
  const [editHospital, setEditHospital] = useState<AdminHospital | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  if (isLoading) {
    return <LoadingState message="กำลังโหลดข้อมูลโรงพยาบาล..." />;
  }

  const hospitals = data?.hospitals ?? [];
  const configuredCount = hospitals.filter((h) => h.bmsConfig?.tunnelUrl).length;
  const connectedCount = hospitals.filter((h) => getTunnelStatus(h) === 'ONLINE').length;

  const handleEdit = (hospital: AdminHospital) => {
    setEditHospital(hospital);
    setTunnelUrl(hospital.bmsConfig?.tunnelUrl ?? '');
    setTestResult(null);
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!editHospital || !tunnelUrl.trim()) return;

    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/admin/hospitals/${editHospital.hcode}/bms-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tunnelUrl: tunnelUrl.trim() }),
      });

      const result = await res.json();

      if (res.ok) {
        setSaveMessage(result.sessionValidated
          ? `บันทึกสำเร็จ — Session validated, DB: ${result.databaseType}`
          : 'บันทึก URL แล้ว — ยังไม่สามารถ validate session ได้'
        );
        mutate();
      } else {
        setSaveMessage(`ผิดพลาด: ${result.error}`);
      }
    } catch {
      setSaveMessage('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!editHospital) return;

    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch(`/api/admin/hospitals/${editHospital.hcode}/test-connection`, {
        method: 'POST',
      });

      const result = await res.json();
      setTestResult(result);
    } catch {
      setTestResult({ connected: false, error: 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const kpis: Array<{ k: string; v: number; color: string; label: string }> = [
    { k: 'TOTAL', v: hospitals.length, color: 'var(--accent-navy)', label: 'โรงพยาบาล' },
    { k: 'ONLINE', v: connectedCount, color: 'var(--risk-low)', label: 'BMS session active' },
    { k: 'CONFIGURED', v: configuredCount, color: 'var(--risk-medium)', label: 'มี Tunnel URL' },
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

      {/* Hospital tiles */}
      <div className="grid grid-cols-1 gap-0 border md:grid-cols-2 xl:grid-cols-3"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        {hospitals.map((h) => {
          const hasConfig = !!h.bmsConfig?.tunnelUrl;
          const tunnelStatus = getTunnelStatus(h);
          const tunnelStatusMeta = TUNNEL_STATUS_META[tunnelStatus];
          const TunnelIcon = tunnelStatusMeta.Icon;
          return (
            <div
              key={h.hcode}
              className="flex flex-col gap-2 border-b border-r bg-white px-4 py-3 last:border-b-0"
              style={{ borderColor: 'var(--rule-hair)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-[var(--ink-navy)]">
                      {h.name}
                    </span>
                    <span
                      className="shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--ink-navy-dim)]"
                      style={{ borderColor: 'var(--rule-strong)' }}
                    >
                      {h.level}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[var(--ink-navy-muted)]">
                    {h.hcode}
                  </div>
                </div>
                <button
                  onClick={() => handleEdit(h)}
                  className="rounded-sm p-1.5 text-[var(--ink-navy-muted)] transition-colors hover:bg-[var(--accent-navy-soft)] hover:text-[var(--accent-navy)]"
                  title="แก้ไข"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                <TunnelIcon className="h-3 w-3" style={{ color: tunnelStatusMeta.color }} />
                <span
                  className={hasConfig ? 'truncate text-[var(--ink-navy-dim)]' : 'text-[var(--ink-navy-muted)]'}
                >
                  {h.bmsConfig?.tunnelUrl ?? 'ยังไม่ตั้งค่า Tunnel URL'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span
                  className="inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em]"
                  style={{
                    color: tunnelStatusMeta.color,
                    borderColor: tunnelStatusMeta.color,
                  }}
                >
                  <TunnelIcon className="h-3 w-3" />
                  {tunnelStatusMeta.label}
                </span>
                <span className="font-mono text-[10px] text-[var(--ink-navy-muted)]">
                  {formatLastSync(h.lastSyncAt)}
                </span>
                {h.bmsConfig?.databaseType && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ink-navy-muted)]">
                    <Database className="h-3 w-3" />
                    {h.bmsConfig.databaseType}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!editHospital} onOpenChange={(open) => !open && setEditHospital(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              แก้ไข BMS Config — {editHospital?.name} ({editHospital?.hcode})
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="tunnelUrl" className="text-sm font-medium text-[var(--ink-navy)]">
                Tunnel URL
              </label>
              <Input
                id="tunnelUrl"
                value={tunnelUrl}
                onChange={(e) => setTunnelUrl(e.target.value)}
                placeholder="https://xxxxx-ondemand-win-xxxxxxxxx.tunnel.hosxp.net"
              />
            </div>

            {saveMessage && (
              <div
                className="border px-3 py-2 font-mono text-[11px]"
                style={{
                  borderColor: saveMessage.includes('สำเร็จ')
                    ? 'var(--risk-low)'
                    : 'var(--risk-high)',
                  color: saveMessage.includes('สำเร็จ')
                    ? 'var(--risk-low)'
                    : 'var(--risk-high)',
                }}
              >
                {saveMessage}
              </div>
            )}

            {testResult && (
              <div
                className="border px-3 py-2 font-mono text-[11px]"
                style={{
                  borderColor: testResult.connected ? 'var(--risk-low)' : 'var(--risk-high)',
                  color: testResult.connected ? 'var(--risk-low)' : 'var(--risk-high)',
                }}
              >
                {testResult.connected ? (
                  <div className="space-y-0.5">
                    <div className="font-semibold">เชื่อมต่อสำเร็จ</div>
                    <div>Database: {testResult.databaseType} — {testResult.databaseVersion}</div>
                    <div>Tables: {testResult.tablesFound?.join(', ') ?? 'none'}</div>
                  </div>
                ) : (
                  <div>เชื่อมต่อไม่สำเร็จ: {testResult.error}</div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !tunnelUrl.trim()}
              className="gap-2"
            >
              <FlaskConical className="h-4 w-4" />
              {testing ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !tunnelUrl.trim()}
              className="gap-2"
              style={{ background: 'var(--accent-navy)' }}
            >
              <Save className="h-4 w-4" />
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
