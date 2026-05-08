// Admin — system configuration. Redesigned 2026-04-21 per the
// air-traffic-control aesthetic: flush header, inline navy tabs,
// sharp-cornered bordered panels.
// 2026-04-22:
//   - added ActiveProvince + Hospitals management tabs (multi-province)
//   - split content into 2-col: tabs on left, live GIS map preview on right
'use client';

import { useState } from 'react';
import { useSetBreadcrumbs } from '@/components/layout/BreadcrumbContext';
import {
  KeyRound,
  Database,
  Globe,
  Building2,
  FlaskConical,
  UsersRound,
  Activity,
} from 'lucide-react';
import { BmsConfigTab } from '@/components/admin/BmsConfigTab';
import { WebhookKeysTab } from '@/components/admin/WebhookKeysTab';
import { ActiveProvinceTab } from '@/components/admin/ActiveProvinceTab';
import { HospitalsTab } from '@/components/admin/HospitalsTab';
import { AdminMapPane } from '@/components/admin/AdminMapPane';
import { SimulationTab } from '@/components/admin/SimulationTab';
import { OnlineUsersTab } from '@/components/admin/OnlineUsersTab';
import { SyncOverviewTab } from '@/components/admin/SyncOverviewTab';
import { cn } from '@/lib/utils';

type TabKey =
  | 'province'
  | 'hospitals'
  | 'bms-config'
  | 'webhook-keys'
  | 'sync-overview'
  | 'online-users'
  | 'simulation';

export default function AdminPage() {
  useSetBreadcrumbs([
    { label: 'แดชบอร์ด', href: '/' },
    { label: 'ตั้งค่า' },
  ]);

  const [activeTab, setActiveTab] = useState<TabKey>('province');
  // Map pin click → HospitalsTab opens the edit dialog for that hcode.
  const [autoEditHcode, setAutoEditHcode] = useState<string | null>(null);

  const handleSelectHospitalFromMap = (hcode: string) => {
    setActiveTab('hospitals');
    setAutoEditHcode(hcode);
  };

  return (
    <div
      style={{
        color: 'var(--ink-navy)',
        background: 'var(--surface-cool)',
        zoom: 1.15,
      }}
    >
      {/* Header strip */}
      <div
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-white px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
            PROVINCIAL REGISTRY · ADMIN
          </div>
          <h1
            className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight"
            style={{ color: 'var(--ink-navy)' }}
          >
            ตั้งค่าระบบ
          </h1>
        </div>
        <p className="font-mono text-[11px] text-[var(--ink-navy-muted)]">
          จังหวัดหลัก · ทะเบียนโรงพยาบาล · BMS Tunnel · Webhook API Keys · Sync Status · Online Users · Simulation
        </p>
      </div>

      {/* Tab strip */}
      <div
        className="flex flex-wrap items-center gap-3 bg-white px-5 py-2.5"
        style={{ borderBottom: '1px solid var(--rule-strong)' }}
      >
        <div
          className="inline-flex items-center border bg-white"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          {(
            [
              { k: 'province' as const, label: 'จังหวัดหลัก', icon: Globe },
              { k: 'hospitals' as const, label: 'โรงพยาบาล', icon: Building2 },
              { k: 'bms-config' as const, label: 'BMS Tunnel', icon: Database },
              { k: 'webhook-keys' as const, label: 'Webhook API Keys', icon: KeyRound },
              { k: 'sync-overview' as const, label: 'Sync Status', icon: Activity },
              { k: 'online-users' as const, label: 'Online Users', icon: UsersRound },
              { k: 'simulation' as const, label: 'จำลองข้อมูล', icon: FlaskConical },
            ]
          ).map((t, i) => {
            const active = activeTab === t.k;
            const Icon = t.icon;
            return (
              <button
                key={t.k}
                onClick={() => setActiveTab(t.k)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] tracking-[0.06em] transition-colors',
                  active ? 'font-semibold' : 'font-normal hover:bg-[var(--accent-navy-soft)]',
                )}
                style={{
                  background: active ? 'var(--accent-navy-soft)' : 'white',
                  color: active ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
                  borderLeft: i > 0 ? '1px solid var(--rule-strong)' : undefined,
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2-col content: tabs on the left, GIS map preview on the right. The
          map is sticky on wide viewports so scrolling the tab content
          (hospital table, keys) doesn't lose the spatial context. */}
      <div
        className="grid gap-0 bg-white"
        style={{ gridTemplateColumns: 'minmax(520px, 1fr) minmax(420px, 1fr)' }}
      >
        <div
          className="px-5 pt-4 pb-6"
          style={{ borderRight: '1px solid var(--rule-strong)' }}
        >
          {activeTab === 'province' ? (
            <ActiveProvinceTab />
          ) : activeTab === 'hospitals' ? (
            <HospitalsTab
              autoEditHcode={autoEditHcode}
              onAutoEditConsumed={() => setAutoEditHcode(null)}
            />
          ) : activeTab === 'bms-config' ? (
            <BmsConfigTab />
          ) : activeTab === 'webhook-keys' ? (
            <WebhookKeysTab />
          ) : activeTab === 'sync-overview' ? (
            <SyncOverviewTab />
          ) : activeTab === 'online-users' ? (
            <OnlineUsersTab />
          ) : (
            <SimulationTab />
          )}
        </div>
        <div className="px-5 pt-4 pb-6">
          <AdminMapPane onSelectHospital={handleSelectHospitalFromMap} />
        </div>
      </div>
    </div>
  );
}
