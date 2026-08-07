// AdminMapPane — GIS preview for the admin page. Shows the active province's
// polygon + amphoe outlines on the left half's map canvas, with pins for
// every hospital registered in the operational `hospitals` table. The map
// component itself reads active-province from /api/admin/config, so a
// successful save in the ActiveProvinceTab (which mutates that SWR key)
// flows through here automatically.
'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { MapPin } from 'lucide-react';
import { ProvinceMap } from '@/components/dashboard/ProvinceMap';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorState } from '@/components/shared/ErrorState';
import type { DashboardHospital, DashboardSyncStatus } from '@/types/api';
import { ConnectionStatus as ConnectionStatusEnum, HospitalLevel } from '@/types/domain';
import { isSyncFailureStatus } from '@/config/sync-status';

interface AdminHospital {
  hcode: string;
  name: string;
  level: string;
  provinceCode: string | null;
  districtCode: string | null;
  lat: number | null;
  lon: number | null;
  isActive: boolean;
  connectionStatus: string;
  lastSyncAt: string | null;
  // Subset of /api/admin/hospitals' bmsConfig — only what the map needs
  // to derive the BLOCKED corner-dot color in lockstep with the dashboard.
  bmsConfig?: {
    authenticity?: {
      status: string | null;
    };
  } | null;
}

interface ProvinceRow {
  code: string;
  name: string;
}

const VALID_LEVELS = new Set<string>(Object.values(HospitalLevel));
const VALID_CONN = new Set<string>(Object.values(ConnectionStatusEnum));

function coerceLevel(raw: string): HospitalLevel {
  return VALID_LEVELS.has(raw) ? (raw as HospitalLevel) : HospitalLevel.F2;
}

function coerceConn(raw: string): ConnectionStatusEnum {
  return VALID_CONN.has(raw) ? (raw as ConnectionStatusEnum) : ConnectionStatusEnum.UNKNOWN;
}

interface AdminMapPaneProps {
  /** Called with the clicked hospital's hcode. In the admin page this opens
   *  the edit dialog in the Hospitals tab. */
  onSelectHospital?: (hcode: string) => void;
}

export function AdminMapPane({ onSelectHospital }: AdminMapPaneProps = {}) {
  const {
    data: hospitalsData,
    isLoading,
    error: hospitalsError,
    mutate: mutateHospitals,
  } = useSWR<{ hospitals: AdminHospital[] }>('/api/admin/hospitals');
  const {
    data: configData,
    error: configError,
    mutate: mutateConfig,
  } = useSWR<{ config: { active_province_code?: string } }>('/api/admin/config');
  const {
    data: provincesData,
    error: provincesError,
    mutate: mutateProvinces,
  } = useSWR<{ provinces: ProvinceRow[] }>('/api/admin/provinces');

  const loadError = hospitalsError || configError || provincesError;

  const activeCode = configData?.config?.active_province_code ?? '40';
  const activeName = provincesData?.provinces.find((p) => p.code === activeCode)?.name ?? '—';

  // The map component expects DashboardHospital objects (with risk counts).
  // Admin context has no live counts — zero them so pins render in the "idle"
  // gray tone and the tooltip shows "ยังไม่มีข้อมูล".
  //
  // syncStatus IS derived (not forced to 'OK') so the BLOCKED amber dot is
  // visible on /admin too — admins manage the very hospitals that get
  // blocked, so they need the same signal the dashboard shows. Rule mirrors
  // src/services/dashboard.ts via SYNC_FAILURE_STATUSES.
  const mapHospitals: DashboardHospital[] = useMemo(() => {
    const rows = hospitalsData?.hospitals ?? [];
    return rows
      .filter((h) => h.isActive)
      .map((h) => {
        const authStatus = h.bmsConfig?.authenticity?.status ?? null;
        let syncStatus: DashboardSyncStatus;
        let syncBlockedReason: string | null = null;
        if (isSyncFailureStatus(authStatus)) {
          syncStatus = 'BLOCKED';
          syncBlockedReason = authStatus;
        } else if (!h.bmsConfig) {
          syncStatus = 'NEVER_SYNCED';
        } else if (!h.lastSyncAt) {
          syncStatus = 'NEVER_SYNCED';
        } else {
          syncStatus = 'OK';
        }
        return {
          hcode: h.hcode,
          name: h.name,
          level: coerceLevel(h.level),
          connectionStatus: coerceConn(h.connectionStatus),
          lastSyncAt: h.lastSyncAt,
          provinceCode: h.provinceCode,
          districtCode: h.districtCode,
          lat: h.lat,
          lon: h.lon,
          counts: { low: 0, medium: 0, high: 0, total: 0 },
          ancCounts: { total: 0, hr3: 0 },
          partographQuality: { laborRecent: 0, withPartograph: 0 },
          syncStatus,
          syncBlockedReason,
        };
      });
  }, [hospitalsData]);

  const pinnedCount = mapHospitals.filter(
    (h) => typeof h.lat === 'number' && typeof h.lon === 'number',
  ).length;
  const totalActive = mapHospitals.length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-navy-muted)]">
          GIS PREVIEW · {activeName} ({activeCode})
        </div>
        <div className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ink-navy-muted)]">
          <MapPin className="h-3 w-3" />
          {pinnedCount}/{totalActive} pinned
        </div>
      </div>
      {/* Leaflet needs a parent with a resolved pixel height — `h-full` inside
          the admin grid column collapses to 0 because the grid row is sized
          by its taller sibling's content. Use an explicit height on the map
          frame so the tiles + GeoJSON always render. */}
      <div
        className="relative w-full overflow-hidden border bg-white"
        style={{ borderColor: 'var(--rule-strong)', height: 560 }}
      >
        {loadError ? (
          // Bordered placeholder (the frame already has a border) so the admin
          // sees an actionable failure instead of a silently blank map.
          <ErrorState
            message="โหลดข้อมูลแผนที่ไม่สำเร็จ — ไม่สามารถแสดงตำแหน่งโรงพยาบาลได้"
            detail="ตรวจสอบการเชื่อมต่อเครือข่ายหรือสิทธิ์ผู้ดูแลระบบ แล้วกดลองใหม่"
            onRetry={() => {
              void mutateHospitals();
              void mutateConfig();
              void mutateProvinces();
            }}
          />
        ) : isLoading ? (
          <LoadingState message="กำลังโหลดข้อมูลโรงพยาบาล..." />
        ) : (
          <ProvinceMap
            hospitals={mapHospitals}
            size="full"
            onSelect={(hcode) => {
              // ProvinceMap's onSelect also fires with null on deselect — we
              // only care about hospital clicks.
              if (hcode && onSelectHospital) onSelectHospital(hcode);
            }}
          />
        )}
      </div>
      <p className="mt-2 font-mono text-[10px] leading-snug text-[var(--ink-navy-muted)]">
        แผนที่ใช้ active province จากการตั้งค่า · โรงพยาบาลที่ไม่มีพิกัดจะใช้ centroid
        ของอำเภอเป็นจุดแสดง
      </p>
    </div>
  );
}
