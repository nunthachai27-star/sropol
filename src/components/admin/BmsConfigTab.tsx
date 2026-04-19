'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Wifi, WifiOff, Pencil, FlaskConical, Save, Database } from 'lucide-react';
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
import { ConnectionStatus } from '@/components/shared/ConnectionStatus';
import { LoadingState } from '@/components/shared/LoadingState';
import { ConnectionStatus as ConnectionStatusEnum } from '@/types/domain';

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
  const connectedCount = hospitals.filter((h) => h.connectionStatus === 'ONLINE').length;

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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border-t-4 border-t-teal-500 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">ทั้งหมด</div>
          <div className="mt-1 font-mono text-2xl font-bold text-slate-800">{hospitals.length}</div>
          <div className="text-xs text-slate-400">โรงพยาบาล</div>
        </div>
        <div className="rounded-xl border-t-4 border-t-green-500 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">ออนไลน์</div>
          <div className="mt-1 font-mono text-2xl font-bold text-green-600">{connectedCount}</div>
          <div className="text-xs text-slate-400">เชื่อมต่อแล้ว</div>
        </div>
        <div className="rounded-xl border-t-4 border-t-amber-500 bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">ตั้งค่าแล้ว</div>
          <div className="mt-1 font-mono text-2xl font-bold text-amber-600">{configuredCount}</div>
          <div className="text-xs text-slate-400">มี Tunnel URL</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {hospitals.map((h) => {
          const hasConfig = !!h.bmsConfig?.tunnelUrl;

          return (
            <div key={h.hcode} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{h.name}</span>
                    <Badge variant="outline" className="text-xs">{h.level}</Badge>
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-400">{h.hcode}</div>
                </div>
                <button
                  onClick={() => handleEdit(h)}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-teal-50 hover:text-teal-600"
                  title="แก้ไข"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  {hasConfig ? (
                    <Wifi className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-slate-300" />
                  )}
                  <span className={hasConfig ? 'truncate text-slate-600' : 'text-slate-400'}>
                    {h.bmsConfig?.tunnelUrl ?? 'ยังไม่ตั้งค่า Tunnel URL'}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <ConnectionStatus
                    status={h.connectionStatus as ConnectionStatusEnum}
                    lastSyncAt={h.lastSyncAt}
                  />
                  {h.bmsConfig?.hasSession && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                      Session Active
                    </span>
                  )}
                  {h.bmsConfig?.databaseType && (
                    <span className="flex items-center gap-1 text-slate-400">
                      <Database className="h-3 w-3" />
                      {h.bmsConfig.databaseType}
                    </span>
                  )}
                </div>
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
              <label htmlFor="tunnelUrl" className="text-sm font-medium text-slate-700">
                Tunnel URL
              </label>
              <Input
                id="tunnelUrl"
                value={tunnelUrl}
                onChange={(e) => setTunnelUrl(e.target.value)}
                placeholder="https://xxxxx-ondemand-win-xxxxxxxxx.tunnel.hosxp.net"
                className="focus-visible:ring-teal-500"
              />
            </div>

            {saveMessage && (
              <div className={`rounded-lg p-3 text-sm ${saveMessage.includes('สำเร็จ') ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-600'}`}>
                {saveMessage}
              </div>
            )}

            {testResult && (
              <div className={`rounded-lg p-3 text-sm ${testResult.connected ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-600'}`}>
                {testResult.connected ? (
                  <div className="space-y-1">
                    <div className="font-medium">เชื่อมต่อสำเร็จ</div>
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
              className="gap-2 bg-teal-600 hover:bg-teal-700"
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
