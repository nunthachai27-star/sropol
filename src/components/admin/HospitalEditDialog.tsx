// HospitalEditDialog — comprehensive hospital settings modal used by the
// admin page. Four tabs:
//   1. General       — name, level, province, lat/lon, active
//   2. Consult Docs  — referral consult doctor contacts for this hospital
//   3. BMS Tunnel    — per-hospital tunnel URL + live test-connection
//   4. Webhook Keys  — create / list / revoke API keys for this hospital
// Each tab persists independently via its own endpoint so partial saves
// don't clobber unrelated fields.
'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Settings2,
  Cable,
  KeyRound,
  MapPin,
  Save,
  FlaskConical,
  Wifi,
  WifiOff,
  AlertTriangle,
  Plus,
  Copy,
  Check,
  Trash2,
  Database,
  CheckCircle2,
  Users,
  Phone,
  Briefcase,
  Pencil,
  Building2,
  CalendarClock,
  Activity,
  ShieldCheck,
  ShieldAlert,
  Eraser,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { HospitalLevel, HospitalServiceType } from '@/types/domain';

const LEVEL_OPTIONS = Object.values(HospitalLevel);

// Three maternity-role tiers requested by the clinical team:
//   PROVINCIAL_HUB            — main provincial / regional referral center
//   DISTRICT_WITH_MATERNITY   — district hospital that runs a labor ward
//   DISTRICT_NO_MATERNITY     — district hospital that only does ANC + refers
interface ServiceTypeMeta {
  value: HospitalServiceType;
  labelTh: string;
  blurb: string;
}
const SERVICE_TYPE_META: ServiceTypeMeta[] = [
  {
    value: HospitalServiceType.PROVINCIAL_HUB,
    labelTh: 'โรงพยาบาลจังหวัด / ศูนย์',
    blurb: 'รับส่งต่อระดับจังหวัด · ห้องคลอดครบวงจร',
  },
  {
    value: HospitalServiceType.DISTRICT_WITH_MATERNITY,
    labelTh: 'รพช. ที่มีห้องคลอด',
    blurb: 'รับคลอดในพื้นที่ · ส่งต่อเมื่อเกินศักยภาพ',
  },
  {
    value: HospitalServiceType.DISTRICT_NO_MATERNITY,
    labelTh: 'รพช. ไม่มีห้องคลอด',
    blurb: 'ฝากครรภ์ + refer ออกทั้งหมด · ไม่ sync partograph',
  },
];

// ───────────────── Types that match existing APIs ─────────────────

export interface AdminHospital {
  hcode: string;
  name: string;
  level: string;
  serviceType: string | null;
  provinceCode: string | null;
  districtCode?: string | null;
  lat?: number | null;
  lon?: number | null;
  isActive: boolean;
  connectionStatus: string;
  lastSyncAt: string | null;
  bmsConfig: {
    tunnelUrl: string;
    hasSession: boolean;
    sessionExpiresAt: string | null;
    databaseType: string | null;
    hasMarketplaceToken?: boolean;
    authenticity?: {
      // null = never probed; 'authentic' = OK;
      // anything else = sync is suppressed for this hospital until re-onboard
      status:
        | 'authentic'
        | 'cid_unstable'
        | 'hn_unstable'
        | 'no_id_field'
        | 'probe_failed'
        | 'missing_marketplace_token'
        | 'no_data'
        | null;
      checkedAt: string | null;
      reason: string | null;
    };
  } | null;
}

export function isHospitalAuthenticityFailure(
  hospital: AdminHospital,
): boolean {
  const status = hospital.bmsConfig?.authenticity?.status;
  if (!status) return false;
  return status !== 'authentic' && status !== 'no_data';
}

export function describeAuthenticityFailure(
  hospital: AdminHospital,
): string {
  const a = hospital.bmsConfig?.authenticity;
  if (!a?.status) return '';
  switch (a.status) {
    case 'missing_marketplace_token':
      return 'ไม่มี marketplace_token — กรุณา onboard ใหม่จากหน้า HOSxP จริงเพื่อบันทึก token ที่ถูกต้อง';
    case 'cid_unstable':
    case 'hn_unstable':
      return 'ข้อมูลที่ได้จาก HOSxP ไม่ผ่านการตรวจสอบ (CID/HN ไม่ตรงกับฐานข้อมูล) — กรุณา onboard ใหม่ผ่าน HOSxP จริงเพื่อขอ marketplace_token ใหม่';
    case 'no_id_field':
      return 'ข้อมูลที่ได้จาก HOSxP ไม่มี CID/HN ที่อ่านได้ — กรุณาตรวจสอบ HOSxP API';
    case 'probe_failed':
      return 'ตรวจสอบความถูกต้องของข้อมูลไม่สำเร็จ — กรุณาตรวจสอบสถานะ BMS Tunnel';
    default:
      return '';
  }
}

interface ProvincesResponse {
  provinces: Array<{ code: string; name: string }>;
}

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

interface ConsultDoctor {
  id: string;
  hospitalId: string;
  hcode: string;
  cid: string;
  name: string;
  position: string | null;
  phoneNumber: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TestResult {
  connected: boolean;
  databaseType?: string;
  databaseVersion?: string;
  tablesFound?: string[];
  error?: string;
}

// ───────────────── Component ─────────────────

type SectionKey = 'general' | 'consult' | 'tunnel' | 'webhooks' | 'danger';
type Tone = 'low' | 'medium' | 'high' | 'muted' | 'navy';

interface Props {
  hospital: AdminHospital | null;
  onClose: () => void;
  /** Called after General save so the parent SWR cache can revalidate. */
  onSaved: () => Promise<void> | void;
}

export function HospitalEditDialog({ hospital, onClose, onSaved }: Props) {
  if (!hospital) return null;

  return (
    <Dialog open={!!hospital} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[94vh] max-w-[calc(100vw-2rem)] overflow-hidden p-0 sm:max-w-none"
        style={{ width: 'min(96vw, 1080px)' }}
      >
        {/* key on the inner shell re-mounts state (active section, form fields)
            when switching hospitals without a useEffect-driven reset. */}
        <DialogInner key={hospital.hcode} hospital={hospital} onClose={onClose} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

function serviceMeta(serviceType: string | null) {
  return SERVICE_TYPE_META.find((s) => s.value === serviceType) ?? null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function coordinatesLabel(hospital: AdminHospital) {
  if (typeof hospital.lat !== 'number' || typeof hospital.lon !== 'number') {
    return 'ยังไม่ได้กำหนด';
  }
  return `${hospital.lat.toFixed(4)}, ${hospital.lon.toFixed(4)}`;
}

function connectionTone(status: string): Tone {
  if (status === 'CONNECTED') return 'low';
  if (status === 'ERROR' || status === 'FAILED') return 'high';
  return 'muted';
}

function toneColor(tone: Tone) {
  if (tone === 'low') return 'var(--risk-low)';
  if (tone === 'medium') return 'var(--risk-medium)';
  if (tone === 'high') return 'var(--risk-high)';
  if (tone === 'navy') return 'var(--accent-navy)';
  return 'var(--ink-navy-muted)';
}

function DialogInner({ hospital, onSaved }: Props & { hospital: AdminHospital }) {
  const [section, setSection] = useState<SectionKey>('general');
  const { data: doctorsData } = useSWR<{ doctors: ConsultDoctor[] }>(
    `/api/admin/hospitals/${hospital.hcode}/consult-doctors`,
  );
  const { data: webhookData } = useSWR<{ keys: WebhookKey[] }>('/api/admin/webhooks');

  const service = serviceMeta(hospital.serviceType);
  const doctorCount = doctorsData?.doctors.length;
  const webhookCount = useMemo(
    () =>
      (webhookData?.keys ?? []).filter((key) => key.hcode === hospital.hcode && key.isActive)
        .length,
    [hospital.hcode, webhookData],
  );
  const hasCoords = typeof hospital.lat === 'number' && typeof hospital.lon === 'number';
  const bmsStatus = hospital.bmsConfig?.hasSession
    ? 'Session active'
    : hospital.bmsConfig?.tunnelUrl
      ? 'URL saved'
      : 'Not configured';
  const tabs: Array<{
    k: SectionKey;
    label: string;
    detail: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      k: 'general',
      label: 'ข้อมูลทั่วไป',
      detail: service?.labelTh ?? 'ยังไม่ระบุประเภท',
      icon: Settings2,
    },
    {
      k: 'consult',
      label: 'Consult Doctors',
      detail: doctorCount === undefined ? 'contacts' : `${doctorCount} contacts`,
      icon: Users,
    },
    { k: 'tunnel', label: 'BMS Tunnel', detail: bmsStatus, icon: Cable },
    {
      k: 'webhooks',
      label: 'Webhook Keys',
      detail: webhookCount === 1 ? '1 active key' : `${webhookCount} active keys`,
      icon: KeyRound,
    },
    {
      k: 'danger',
      label: 'Danger Zone',
      detail: 'ลบข้อมูลคลินิก',
      icon: ShieldAlert,
    },
  ];

  return (
    <>
      <DialogHeader className="border-b bg-white px-5 pt-4 pb-4"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <DialogTitle className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--ink-navy-muted)]">
                  <Building2 className="h-3.5 w-3.5" />
                  Hospital Operations Profile
                </span>
                <span
                  className="border px-2 py-0.5 font-mono text-[12px]"
                  style={{
                    borderColor: 'var(--rule-strong)',
                    color: 'var(--ink-navy-dim)',
                    background: 'var(--surface-cool)',
                  }}
                >
                  HCODE {hospital.hcode}
                </span>
              </div>
              <div
                className="mt-1 truncate text-[20px] font-semibold leading-tight"
                style={{ color: 'var(--ink-navy)' }}
              >
                {hospital.name}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusPill
                  tone={hospital.isActive ? 'low' : 'muted'}
                  Icon={hospital.isActive ? CheckCircle2 : AlertTriangle}
                  label={hospital.isActive ? 'ACTIVE' : 'INACTIVE'}
                />
                <StatusPill
                  tone={connectionTone(hospital.connectionStatus)}
                  Icon={Activity}
                  label={`SYNC ${hospital.connectionStatus || 'UNKNOWN'}`}
                />
                <StatusPill
                  tone={hospital.bmsConfig?.hasSession ? 'low' : hospital.bmsConfig?.tunnelUrl ? 'medium' : 'muted'}
                  Icon={Database}
                  label={bmsStatus}
                />
              </div>
            </div>

            <div
              className="grid grid-cols-2 gap-2 text-left md:w-[360px]"
              style={{ color: 'var(--ink-navy)' }}
            >
              <ProfileMetric label="LEVEL" value={hospital.level} Icon={ShieldCheck} tone="navy" />
              <ProfileMetric
                label="LAST SYNC"
                value={formatDateTime(hospital.lastSyncAt)}
                Icon={CalendarClock}
                tone={hospital.lastSyncAt ? 'navy' : 'muted'}
              />
            </div>
          </div>

          <div
            className="grid gap-2 border px-3 py-2 text-[12px] md:grid-cols-[1.2fr_1fr_1fr]"
            style={{ borderColor: 'var(--rule-strong)', background: 'var(--surface-cool)' }}
          >
            <HeaderFact label="SERVICE" value={service?.labelTh ?? 'ยังไม่ระบุประเภท'} />
            <HeaderFact
              label="COORDINATES"
              value={coordinatesLabel(hospital)}
              Icon={MapPin}
              muted={!hasCoords}
            />
            <HeaderFact
              label="DATABASE"
              value={hospital.bmsConfig?.databaseType ?? 'ยังไม่ทราบชนิดฐานข้อมูล'}
              Icon={Database}
              muted={!hospital.bmsConfig?.databaseType}
            />
          </div>
        </DialogTitle>
      </DialogHeader>

        {/* Section tabs */}
        <div
          className="flex overflow-x-auto border-b bg-white px-5"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          {tabs.map((t) => {
            const active = section === t.k;
            const Icon = t.icon;
            return (
              <button
                key={t.k}
                onClick={() => setSection(t.k)}
                className={cn(
                  'relative -mb-px inline-flex min-w-[160px] items-center gap-2 px-3 py-2.5 text-left transition-colors',
                  active ? 'font-semibold' : 'font-normal hover:text-[var(--accent-navy)]',
                )}
                style={{
                  color: active ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
                  borderBottom: active
                    ? '2px solid var(--accent-navy)'
                    : '2px solid transparent',
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[13px] tracking-[0.03em]">
                    {t.label}
                  </span>
                  <span className="block truncate font-mono text-[12px] font-normal text-[var(--ink-navy-muted)]">
                    {t.detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Section content — fixed-ish height so switching tabs doesn't jitter */}
        <div
          className="max-h-[calc(94vh-230px)] min-h-[340px] overflow-y-auto px-5 py-4"
          style={{ background: 'var(--surface-cool)' }}
        >
        {section === 'general' ? (
          <GeneralSection hospital={hospital} onSaved={onSaved} />
        ) : section === 'consult' ? (
          <ConsultDoctorsSection hospital={hospital} />
        ) : section === 'tunnel' ? (
          <TunnelSection hospital={hospital} />
        ) : section === 'webhooks' ? (
          <WebhooksSection hospital={hospital} />
        ) : (
          <DangerZoneSection hospital={hospital} onSaved={onSaved} />
        )}
      </div>
    </>
  );
}

// ───────────────── General section ─────────────────

function GeneralSection({
  hospital,
  onSaved,
}: {
  hospital: AdminHospital;
  onSaved: () => Promise<void> | void;
}) {
  const { data: provincesData } = useSWR<ProvincesResponse>('/api/admin/provinces');
  const [name, setName] = useState(hospital.name);
  const [level, setLevel] = useState(hospital.level);
  const [serviceType, setServiceType] = useState<string>(
    hospital.serviceType ?? HospitalServiceType.DISTRICT_WITH_MATERNITY,
  );
  const [provinceCode, setProvinceCode] = useState(hospital.provinceCode ?? '');
  const [lat, setLat] = useState(
    typeof hospital.lat === 'number' ? String(hospital.lat) : '',
  );
  const [lon, setLon] = useState(
    typeof hospital.lon === 'number' ? String(hospital.lon) : '',
  );
  const [isActive, setIsActive] = useState(hospital.isActive);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setName(hospital.name);
    setLevel(hospital.level);
    setServiceType(hospital.serviceType ?? HospitalServiceType.DISTRICT_WITH_MATERNITY);
    setProvinceCode(hospital.provinceCode ?? '');
    setLat(typeof hospital.lat === 'number' ? String(hospital.lat) : '');
    setLon(typeof hospital.lon === 'number' ? String(hospital.lon) : '');
    setIsActive(hospital.isActive);
    setMessage(null);
  }, [hospital.hcode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const latNum = lat === '' ? null : Number(lat);
      const lonNum = lon === '' ? null : Number(lon);
      if (lat !== '' && !Number.isFinite(latNum)) throw new Error('lat ไม่ถูกต้อง');
      if (lon !== '' && !Number.isFinite(lonNum)) throw new Error('lon ไม่ถูกต้อง');

      const res = await fetch(`/api/admin/hospitals/${hospital.hcode}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          level,
          serviceType,
          provinceCode: provinceCode || null,
          lat: latNum,
          lon: lonNum,
          isActive,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'บันทึกไม่สำเร็จ');
      }
      setMessage('บันทึกสำเร็จ');
      await onSaved();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionIntro
        eyebrow="Hospital identity"
        title="ข้อมูลหลักของโรงพยาบาล"
        detail="ข้อมูลนี้ใช้กำหนดบทบาทบริการ สถานะการใช้งาน และตำแหน่งบนแผนที่ของระบบ"
        Icon={Settings2}
        meta={`Status: ${isActive ? 'ACTIVE' : 'INACTIVE'}`}
      />

      {/* Service-type picker — three radio-card tiles so the ops team sees the
          consequence blurb before committing. Drives sync eligibility and
          dashboard filters, so worth surfacing above the MOPH level. */}
      <div>
        <div className="mb-1 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink-navy-muted)]">
          SERVICE TYPE · ประเภทการให้บริการ
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {SERVICE_TYPE_META.map((m) => {
            const active = serviceType === m.value;
            return (
              <button
                type="button"
                key={m.value}
                onClick={() => setServiceType(m.value)}
                className="flex flex-col gap-0.5 border px-3 py-2 text-left transition-colors"
                style={{
                  borderColor: active ? 'var(--accent-navy)' : 'var(--rule-strong)',
                  background: active ? 'var(--accent-navy-soft)' : 'white',
                  color: active ? 'var(--accent-navy)' : 'var(--ink-navy-dim)',
                  boxShadow: active ? 'inset 0 0 0 1px var(--accent-navy)' : undefined,
                }}
              >
                <div className="text-[13px] font-semibold leading-tight">{m.labelTh}</div>
                <div className="font-mono text-[12px] leading-snug text-[var(--ink-navy-muted)]">
                  {m.blurb}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="ชื่อโรงพยาบาล">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        </Field>
        <Field label="ระดับ MOPH">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="h-9 w-full border bg-white px-2 font-mono text-sm"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="จังหวัด">
          <select
            value={provinceCode}
            onChange={(e) => setProvinceCode(e.target.value)}
            className="h-9 w-full border bg-white px-2 font-mono text-sm"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            <option value="">—</option>
            {(provincesData?.provinces ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="สถานะ">
          <label className="inline-flex h-9 items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            เปิดใช้งาน (ส่งผลต่อการ sync และแสดงบน dashboard)
          </label>
        </Field>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink-navy-muted)]">
          <MapPin className="h-3 w-3" />
          GEO COORDINATES · ใช้สำหรับปักหมุดบนแผนที่
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude">
            <Input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="16.4419"
              className="h-9 font-mono"
            />
          </Field>
          <Field label="Longitude">
            <Input
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              placeholder="102.8358"
              className="h-9 font-mono"
            />
          </Field>
        </div>
        <p className="mt-1 font-mono text-[12px] leading-snug text-[var(--ink-navy-muted)]">
          ถ้าไม่ใส่พิกัด ระบบจะใช้ centroid ของอำเภอแทน
        </p>
      </div>

      {message ? (
        <div
          className="border px-3 py-2 font-mono text-[11px]"
          style={{
            borderColor: message === 'บันทึกสำเร็จ' ? 'var(--risk-low)' : 'var(--risk-high)',
            color: message === 'บันทึกสำเร็จ' ? 'var(--risk-low)' : 'var(--risk-high)',
            background: 'white',
          }}
        >
          {message}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={busy || !name.trim()} className="gap-1.5">
          <Save className="h-4 w-4" />
          {busy ? 'กำลังบันทึก...' : 'บันทึก'}
        </Button>
      </div>
    </div>
  );
}

// ───────────────── Consult doctors section ─────────────────

interface DoctorFormState {
  id: string | null;
  cid: string;
  name: string;
  position: string;
  phoneNumber: string;
}

const EMPTY_DOCTOR_FORM: DoctorFormState = {
  id: null,
  cid: '',
  name: '',
  position: '',
  phoneNumber: '',
};

function ConsultDoctorsSection({ hospital }: { hospital: AdminHospital }) {
  const { data, isLoading, mutate } = useSWR<{ doctors: ConsultDoctor[] }>(
    `/api/admin/hospitals/${hospital.hcode}/consult-doctors`,
  );
  const [form, setForm] = useState<DoctorFormState>(EMPTY_DOCTOR_FORM);
  const [busy, setBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setForm(EMPTY_DOCTOR_FORM);
    setMessage(null);
    setDeleteBusyId(null);
  }, [hospital.hcode]);

  const doctors = data?.doctors ?? [];
  const editing = !!form.id;
  const phoneCount = doctors.filter((doctor) => !!doctor.phoneNumber).length;

  const setField = (key: keyof DoctorFormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resetForm = () => {
    setForm(EMPTY_DOCTOR_FORM);
    setMessage(null);
  };

  const startEdit = (doctor: ConsultDoctor) => {
    setForm({
      id: doctor.id,
      cid: doctor.cid,
      name: doctor.name,
      position: doctor.position ?? '',
      phoneNumber: doctor.phoneNumber ?? '',
    });
    setMessage(null);
  };

  const handleSave = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const cid = form.cid.trim();
      const name = form.name.trim();
      if (!/^\d{13}$/.test(cid)) {
        throw new Error('CID ต้องเป็นตัวเลข 13 หลัก');
      }
      if (!name) {
        throw new Error('กรุณาระบุชื่อแพทย์');
      }

      const path = editing
        ? `/api/admin/hospitals/${hospital.hcode}/consult-doctors/${form.id}`
        : `/api/admin/hospitals/${hospital.hcode}/consult-doctors`;
      const res = await fetch(path, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cid,
          name,
          position: form.position.trim() || null,
          phoneNumber: form.phoneNumber.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'บันทึกไม่สำเร็จ');
      }

      await mutate();
      setForm(EMPTY_DOCTOR_FORM);
      setMessage({ tone: 'ok', text: editing ? 'แก้ไขแพทย์ consult สำเร็จ' : 'เพิ่มแพทย์ consult สำเร็จ' });
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (doctor: ConsultDoctor) => {
    if (!confirm(`ลบแพทย์ consult ${doctor.name}?`)) return;
    setDeleteBusyId(doctor.id);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/hospitals/${hospital.hcode}/consult-doctors/${doctor.id}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'ลบไม่สำเร็จ');
      }
      if (form.id === doctor.id) {
        setForm(EMPTY_DOCTOR_FORM);
      }
      await mutate();
      setMessage({ tone: 'ok', text: 'ลบแพทย์ consult สำเร็จ' });
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setDeleteBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <SectionIntro
        eyebrow="Referral contacts"
        title="แพทย์ Consult ประจำโรงพยาบาล"
        detail="รายชื่อแพทย์ที่ใช้สำหรับประสานงานเคสส่งต่อและการปรึกษาทางคลินิก"
        Icon={Users}
        meta={`${doctors.length} doctors · ${phoneCount} phone numbers`}
      />

      <div className="border bg-white p-4" style={{ borderColor: 'var(--rule-strong)' }}>
        <div className="mb-3 flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em]">
          <Users className="h-3 w-3" style={{ color: 'var(--accent-navy)' }} />
          <span style={{ color: 'var(--accent-navy)' }}>
            {editing ? 'แก้ไขแพทย์ Consult' : 'เพิ่มแพทย์ Consult'}
          </span>
          <span className="text-[var(--ink-navy-muted)]">· {hospital.hcode}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="CID">
            <Input
              value={form.cid}
              onChange={(e) => setField('cid', e.target.value.replace(/\D/g, '').slice(0, 13))}
              placeholder="1234567890123"
              className="h-9 font-mono"
              inputMode="numeric"
              maxLength={13}
            />
          </Field>
          <Field label="ชื่อแพทย์">
            <Input
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="ชื่อ-สกุล"
              className="h-9"
            />
          </Field>
          <Field label="ตำแหน่ง">
            <div className="relative">
              <Briefcase className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-[var(--ink-navy-muted)]" />
              <Input
                value={form.position}
                onChange={(e) => setField('position', e.target.value)}
                placeholder="เช่น สูติแพทย์"
                className="h-9 pl-8"
              />
            </div>
          </Field>
          <Field label="เบอร์โทรศัพท์">
            <div className="relative">
              <Phone className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-[var(--ink-navy-muted)]" />
              <Input
                value={form.phoneNumber}
                onChange={(e) => setField('phoneNumber', e.target.value)}
                placeholder="08x-xxx-xxxx"
                className="h-9 pl-8 font-mono"
              />
            </div>
          </Field>
        </div>

        {message ? (
          <div
            className="mt-3 border px-3 py-2 font-mono text-[11px]"
            style={{
              borderColor: message.tone === 'ok' ? 'var(--risk-low)' : 'var(--risk-high)',
              color: message.tone === 'ok' ? 'var(--risk-low)' : 'var(--risk-high)',
              background: 'white',
            }}
          >
            {message.text}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {editing ? (
            <Button variant="ghost" onClick={resetForm} disabled={busy}>
              ยกเลิก
            </Button>
          ) : null}
          <Button onClick={handleSave} disabled={busy || !form.cid.trim() || !form.name.trim()} className="gap-1.5">
            <Save className="h-4 w-4" />
            {busy ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'เพิ่มแพทย์'}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto border bg-white" style={{ borderColor: 'var(--rule-strong)' }}>
        <div
          className="grid min-w-[720px] gap-2 border-b px-3 py-2 font-mono text-[12px] tracking-[0.06em] text-[var(--ink-navy-muted)]"
          style={{
            gridTemplateColumns: '130px minmax(180px,1fr) minmax(120px,160px) minmax(120px,150px) 90px',
            borderColor: 'var(--rule-strong)',
          }}
        >
          <div>CID</div>
          <div>NAME</div>
          <div>POSITION</div>
          <div>PHONE</div>
          <div className="text-right">ACTION</div>
        </div>
        {isLoading ? (
          <div className="px-3 py-6 text-center font-mono text-[11px] text-[var(--ink-navy-muted)]">
            กำลังโหลดรายชื่อแพทย์ consult...
          </div>
        ) : doctors.length === 0 ? (
          <div className="px-3 py-6 text-center font-mono text-[11px] text-[var(--ink-navy-muted)]">
            ยังไม่มีแพทย์ consult สำหรับโรงพยาบาลนี้
          </div>
        ) : (
          doctors.map((doctor) => (
            <div
              key={doctor.id}
              className="grid min-w-[720px] items-center gap-2 border-b px-3 py-2 text-[12px] last:border-b-0"
              style={{
                gridTemplateColumns: '130px minmax(180px,1fr) minmax(120px,160px) minmax(120px,150px) 90px',
                borderColor: 'var(--rule-hair)',
              }}
            >
              <code className="font-mono text-[12px] text-[var(--ink-navy-dim)]">{doctor.cid}</code>
              <div className="truncate font-medium text-[var(--ink-navy)]">{doctor.name}</div>
              <div className="truncate text-[var(--ink-navy-dim)]">{doctor.position ?? '—'}</div>
              <div className="truncate font-mono text-[12px] text-[var(--ink-navy-dim)]">
                {doctor.phoneNumber ?? '—'}
              </div>
              <div className="flex justify-end gap-1">
                <button
                  onClick={() => startEdit(doctor)}
                  className="inline-flex items-center gap-1 px-1.5 py-1 font-mono text-[12px] hover:bg-[var(--accent-navy-soft)]"
                  style={{ color: 'var(--ink-navy-dim)' }}
                  disabled={busy || !!deleteBusyId}
                >
                  <Pencil className="h-3 w-3" />
                  แก้
                </button>
                <button
                  onClick={() => handleDelete(doctor)}
                  className="inline-flex items-center gap-1 px-1.5 py-1 font-mono text-[12px] hover:bg-red-50"
                  style={{ color: 'var(--risk-high)' }}
                  disabled={busy || deleteBusyId === doctor.id}
                >
                  <Trash2 className="h-3 w-3" />
                  ลบ
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ───────────────── Tunnel section ─────────────────

function TunnelSection({ hospital }: { hospital: AdminHospital }) {
  const [tunnelUrl, setTunnelUrl] = useState(hospital.bmsConfig?.tunnelUrl ?? '');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    setTunnelUrl(hospital.bmsConfig?.tunnelUrl ?? '');
    setSaveMessage(null);
    setTestResult(null);
  }, [hospital.hcode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!tunnelUrl.trim()) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(`/api/admin/hospitals/${hospital.hcode}/bms-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tunnelUrl: tunnelUrl.trim() }),
      });
      const result = await res.json();
      if (!res.ok) {
        setSaveMessage(`ผิดพลาด: ${result.error ?? 'บันทึกไม่สำเร็จ'}`);
        return;
      }
      setSaveMessage(
        result.sessionValidated
          ? `บันทึกสำเร็จ — Session validated, DB: ${result.databaseType}`
          : 'บันทึก URL แล้ว — ยังไม่สามารถ validate session ได้',
      );
    } catch {
      setSaveMessage('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(
        `/api/admin/hospitals/${hospital.hcode}/test-connection`,
        { method: 'POST' },
      );
      const result = (await res.json()) as TestResult;
      setTestResult(result);
    } catch {
      setTestResult({ connected: false, error: 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const hasUrl = !!hospital.bmsConfig?.tunnelUrl;

  return (
    <div className="space-y-4">
      <SectionIntro
        eyebrow="BMS connectivity"
        title="สถานะการเชื่อมต่อฐานข้อมูลโรงพยาบาล"
        detail="ตั้งค่า tunnel, session, และตรวจสอบชนิดฐานข้อมูลที่ใช้สำหรับ sync ข้อมูล"
        Icon={Cable}
        meta={hospital.bmsConfig?.databaseType ?? 'Database: —'}
      />

      {/* Status strip */}
      <div
        className="grid gap-0 border bg-white"
        style={{
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          borderColor: 'var(--rule-strong)',
        }}
      >
        <StatBox
          label="TUNNEL URL"
          value={hasUrl ? 'configured' : 'not set'}
          tone={hasUrl ? 'low' : 'muted'}
          Icon={hasUrl ? Wifi : WifiOff}
        />
        <StatBox
          label="SESSION"
          value={hospital.bmsConfig?.hasSession ? 'active' : '—'}
          tone={hospital.bmsConfig?.hasSession ? 'low' : 'muted'}
          Icon={hospital.bmsConfig?.hasSession ? CheckCircle2 : AlertTriangle}
        />
        <StatBox
          label="DATABASE"
          value={hospital.bmsConfig?.databaseType ?? '—'}
          tone={hospital.bmsConfig?.databaseType ? 'navy' : 'muted'}
          Icon={Database}
        />
      </div>

      <div className="border bg-white p-4" style={{ borderColor: 'var(--rule-strong)' }}>
        <Field label="Tunnel URL">
          <Input
            value={tunnelUrl}
            onChange={(e) => setTunnelUrl(e.target.value)}
            placeholder="https://xxxxx-ondemand-win-xxxxxxxxx.tunnel.hosxp.net"
            className="h-9 font-mono text-[12px]"
          />
        </Field>
        <p className="mt-1 font-mono text-[12px] leading-snug text-[var(--ink-navy-muted)]">
          ระบบจะใช้ URL นี้สำหรับดึงข้อมูลจาก BMS ของโรงพยาบาล · ต้องสามารถเข้าถึงได้จากเซิร์ฟเวอร์ของระบบ
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving || !tunnelUrl.trim()} className="gap-1.5">
            <Save className="h-4 w-4" />
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
          <Button
            onClick={handleTest}
            disabled={testing || !hasUrl}
            variant="outline"
            className="gap-1.5"
          >
            <FlaskConical className="h-4 w-4" />
            {testing ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
          </Button>
        </div>

        {saveMessage ? (
          <div
            className="mt-3 border px-3 py-2 font-mono text-[11px]"
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
        ) : null}

        {testResult ? (
          <div
            className="mt-3 space-y-1 border px-3 py-2 font-mono text-[11px]"
            style={{
              borderColor: testResult.connected ? 'var(--risk-low)' : 'var(--risk-high)',
              color: testResult.connected ? 'var(--risk-low)' : 'var(--risk-high)',
            }}
          >
            <div>
              {testResult.connected ? '✓ เชื่อมต่อสำเร็จ' : '✗ เชื่อมต่อไม่สำเร็จ'}
              {testResult.databaseType ? ` · ${testResult.databaseType}` : ''}
              {testResult.databaseVersion ? ` · v${testResult.databaseVersion}` : ''}
            </div>
            {testResult.tablesFound && testResult.tablesFound.length > 0 ? (
              <div className="text-[var(--ink-navy-dim)]">
                Tables: {testResult.tablesFound.slice(0, 5).join(', ')}
                {testResult.tablesFound.length > 5 ? '…' : ''}
              </div>
            ) : null}
            {testResult.error ? (
              <div className="text-[var(--ink-navy-dim)]">Error: {testResult.error}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────── Webhooks section ─────────────────

function WebhooksSection({ hospital }: { hospital: AdminHospital }) {
  const { data, mutate } = useSWR<{ keys: WebhookKey[] }>('/api/admin/webhooks');
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{
    apiKey: string;
    keyPrefix: string;
    label: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<WebhookKey | null>(null);
  const [revokeInput, setRevokeInput] = useState('');
  const [revoking, setRevoking] = useState(false);

  // Filter keys to this hospital only so the dialog is focused.
  const keys = useMemo(
    () => (data?.keys ?? []).filter((k) => k.hcode === hospital.hcode),
    [data, hospital.hcode],
  );
  const activeKeyCount = keys.filter((key) => key.isActive).length;

  const handleCreate = async () => {
    if (!label.trim()) return;
    setCreating(true);
    setCreateError(null);
    setJustCreated(null);
    setCopied(false);
    try {
      const res = await fetch('/api/admin/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hcode: hospital.hcode, label: label.trim() }),
      });
      const result = await res.json();
      if (!res.ok) {
        setCreateError(result.error ?? 'สร้างไม่สำเร็จ');
        return;
      }
      setJustCreated({
        apiKey: result.apiKey,
        keyPrefix: result.keyPrefix,
        label: result.label,
      });
      setLabel('');
      await mutate();
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
      // clipboard blocked — user can select manually
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget || revokeInput !== revokeTarget.keyPrefix) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/admin/webhooks/${revokeTarget.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(err?.error ?? 'ยกเลิกไม่สำเร็จ');
        return;
      }
      setRevokeTarget(null);
      setRevokeInput('');
      await mutate();
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionIntro
        eyebrow="Integration access"
        title="Webhook API Keys"
        detail="คีย์สำหรับรับข้อมูลจากระบบภายนอกของโรงพยาบาลนี้"
        Icon={KeyRound}
        meta={`${activeKeyCount} active · ${keys.length - activeKeyCount} revoked`}
      />

      {/* Create form */}
      <div className="border bg-white p-4" style={{ borderColor: 'var(--rule-strong)' }}>
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em]">
          <KeyRound className="h-3 w-3" style={{ color: 'var(--accent-navy)' }} />
          <span style={{ color: 'var(--accent-navy)' }}>สร้าง API Key ใหม่</span>
          <span className="text-[var(--ink-navy-muted)]">· {hospital.hcode}</span>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1" style={{ minWidth: 260 }}>
            <Field label="Label">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="เช่น Production webhook"
                className="h-9"
              />
            </Field>
          </div>
          <Button onClick={handleCreate} disabled={creating || !label.trim()} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {creating ? 'กำลังสร้าง...' : 'สร้าง Key'}
          </Button>
        </div>
        {createError ? (
          <div
            className="mt-2 border px-3 py-2 font-mono text-[11px]"
            style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)' }}
          >
            {createError}
          </div>
        ) : null}
      </div>

      {/* Just-created reveal */}
      {justCreated ? (
        <div
          className="border-2 bg-white px-4 py-3"
          style={{ borderColor: 'var(--risk-medium)' }}
        >
          <div className="mb-2 flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: 'var(--risk-medium)' }}
            />
            <div>
              <div
                className="font-mono text-[12px] font-semibold uppercase tracking-[0.06em]"
                style={{ color: 'var(--risk-medium)' }}
              >
                บันทึก API Key นี้ไว้ทันที — ระบบจะไม่แสดงอีก
              </div>
              <div className="mt-0.5 font-mono text-[12px] text-[var(--ink-navy-dim)]">
                {justCreated.label}
              </div>
            </div>
          </div>
          <div
            className="flex items-center gap-2 border bg-[var(--surface-cool)] px-3 py-2"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            <code className="flex-1 overflow-x-auto font-mono text-[12px] text-[var(--ink-navy)]">
              {justCreated.apiKey}
            </code>
            <Button onClick={handleCopy} variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]">
              {copied ? (
                <Check className="h-3 w-3" style={{ color: 'var(--risk-low)' }} />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Keys list */}
      <div className="border bg-white" style={{ borderColor: 'var(--rule-strong)' }}>
        <div
          className="grid gap-2 border-b px-3 py-2 font-mono text-[12px] tracking-[0.06em] text-[var(--ink-navy-muted)]"
          style={{ gridTemplateColumns: '1fr 110px 120px 70px 80px', borderColor: 'var(--rule-strong)' }}
        >
          <div>LABEL</div>
          <div>PREFIX</div>
          <div>LAST USED</div>
          <div>STATUS</div>
          <div className="text-right">ACTION</div>
        </div>
        {keys.length === 0 ? (
          <div className="px-3 py-6 text-center font-mono text-[11px] text-[var(--ink-navy-muted)]">
            ยังไม่มี API Key สำหรับโรงพยาบาลนี้
          </div>
        ) : (
          keys.map((k) => (
            <div
              key={k.id}
              className="grid items-center gap-2 border-b px-3 py-2 text-[12px] last:border-b-0"
              style={{
                gridTemplateColumns: '1fr 110px 120px 70px 80px',
                borderColor: 'var(--rule-hair)',
                opacity: k.isActive ? 1 : 0.55,
              }}
            >
              <div className="truncate">{k.label}</div>
              <code
                className="border px-1.5 py-0.5 font-mono text-[12px] text-[var(--ink-navy-dim)]"
                style={{ borderColor: 'var(--rule-strong)', background: 'var(--surface-cool)' }}
              >
                {k.keyPrefix}…
              </code>
              <div className="font-mono text-[12px] text-[var(--ink-navy-dim)]">
                {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString('th-TH') : '—'}
              </div>
              <div>
                <span
                  className="inline-block border px-1.5 py-0.5 font-mono text-[12px] font-semibold tracking-[0.04em]"
                  style={{
                    color: k.isActive ? 'var(--risk-low)' : 'var(--ink-navy-muted)',
                    borderColor: k.isActive ? 'var(--risk-low)' : 'var(--rule-strong)',
                  }}
                >
                  {k.isActive ? 'ACTIVE' : 'REVOKED'}
                </span>
              </div>
              <div className="text-right">
                {k.isActive ? (
                  <button
                    onClick={() => {
                      setRevokeTarget(k);
                      setRevokeInput('');
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-1 font-mono text-[12px] hover:bg-red-50"
                    style={{ color: 'var(--risk-high)' }}
                  >
                    <Trash2 className="h-3 w-3" />
                    ยกเลิก
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Inline revoke confirm */}
      {revokeTarget ? (
        <div
          className="border-2 bg-white p-3"
          style={{ borderColor: 'var(--risk-high)' }}
        >
          <div className="mb-2 flex items-center gap-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.06em]"
            style={{ color: 'var(--risk-high)' }}>
            <AlertTriangle className="h-3.5 w-3.5" />
            ยืนยันการยกเลิก · {revokeTarget.label}
          </div>
          <p className="mb-2 font-mono text-[12px] leading-snug text-[var(--ink-navy-dim)]">
            คีย์ที่ยกเลิกแล้วจะใช้ไม่ได้ทันที · พิมพ์ prefix <code>{revokeTarget.keyPrefix}</code> เพื่อยืนยัน
          </p>
          <div className="flex gap-2">
            <Input
              value={revokeInput}
              onChange={(e) => setRevokeInput(e.target.value)}
              placeholder={revokeTarget.keyPrefix}
              className="h-9 font-mono"
              autoFocus
            />
            <Button variant="ghost" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              ยกเลิก
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={revoking || revokeInput !== revokeTarget.keyPrefix}
              className="gap-1.5"
            >
              <Trash2 className="h-4 w-4" />
              {revoking ? 'กำลังยกเลิก...' : 'ยืนยัน'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ───────────────── Danger Zone section ─────────────────

interface PurgeCounts {
  cpd_scores?: number;
  cached_vital_signs?: number;
  cached_partograph_observations?: number;
  cached_anc_visits?: number;
  cached_anc_risks?: number;
  cached_newborns?: number;
  cached_referrals?: number;
  cached_patients?: number;
  maternal_journeys?: number;
}

interface PurgeResult {
  ok?: boolean;
  stoppedSync?: boolean;
  totalRowsDeleted?: number;
  counts?: PurgeCounts;
  error?: string;
  detail?: string;
}

const PURGE_TABLE_LABELS: Array<{ key: keyof PurgeCounts; label: string }> = [
  { key: 'cached_patients', label: 'ผู้ป่วย (cached_patients)' },
  { key: 'maternal_journeys', label: 'Journey (maternal_journeys)' },
  { key: 'cached_partograph_observations', label: 'Partograph observations' },
  { key: 'cached_vital_signs', label: 'Vital signs' },
  { key: 'cpd_scores', label: 'CPD scores' },
  { key: 'cached_anc_visits', label: 'ANC visits' },
  { key: 'cached_anc_risks', label: 'ANC risks' },
  { key: 'cached_newborns', label: 'ทารกแรกเกิด' },
  { key: 'cached_referrals', label: 'Referrals' },
];

interface CountsResponse {
  ok?: boolean;
  totalRows?: number;
  counts?: PurgeCounts;
  error?: string;
}

function DangerZoneSection({
  hospital,
  onSaved,
}: {
  hospital: AdminHospital;
  onSaved: () => Promise<void> | void;
}) {
  const { data: countsData, isLoading: countsLoading, mutate: mutateCounts } =
    useSWR<CountsResponse>(`/api/admin/hospitals/${hospital.hcode}/data`);
  const [confirmInput, setConfirmInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PurgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setConfirmInput('');
    setResult(null);
    setError(null);
  }, [hospital.hcode]);

  const liveCounts = countsData?.counts ?? null;
  const liveTotal = countsData?.totalRows ?? 0;

  const canSubmit = confirmInput.trim() === hospital.hcode && !busy;

  const handlePurge = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/hospitals/${hospital.hcode}/data`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmHcode: hospital.hcode }),
      });
      const payload = (await res.json().catch(() => null)) as PurgeResult | null;
      if (!res.ok || !payload?.ok) {
        const msg = payload?.detail ?? payload?.error ?? `HTTP ${res.status}`;
        setError(`ลบข้อมูลไม่สำเร็จ: ${msg}`);
        return;
      }
      setResult(payload);
      setConfirmInput('');
      await mutateCounts();
      await onSaved();
    } catch (e) {
      setError(`ลบข้อมูลไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const lines: Array<{ label: string; count: number }> = result?.counts
    ? PURGE_TABLE_LABELS
        .map((t) => ({ label: t.label, count: result.counts?.[t.key] ?? 0 }))
        .filter((row) => row.count > 0)
    : [];

  return (
    <div className="space-y-4">
      <SectionIntro
        eyebrow="Destructive operations"
        title="Danger Zone — ลบข้อมูลของโรงพยาบาลนี้"
        detail="ใช้สำหรับล้างข้อมูล cached เพื่อ re-onboard ใหม่ · จะไม่ลบ tunnel config / consult doctors / webhook keys"
        Icon={ShieldAlert}
        meta={
          countsLoading
            ? 'กำลังนับ...'
            : `${liveTotal.toLocaleString('th-TH')} แถวในระบบ`
        }
      />

      {/* Live counts — what's currently in kk-lrms for this hospital */}
      <div
        className="border bg-white"
        style={{ borderColor: 'var(--rule-strong)' }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-2"
          style={{ borderColor: 'var(--rule-strong)', background: 'var(--surface-cool)' }}
        >
          <div className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink-navy-muted)]">
            <Database className="h-3 w-3" />
            ข้อมูลปัจจุบันในระบบ · HCODE {hospital.hcode}
          </div>
          <div
            className="font-mono text-[13px] font-semibold tracking-[0.04em]"
            style={{ color: liveTotal > 0 ? 'var(--accent-navy)' : 'var(--ink-navy-muted)' }}
          >
            {countsLoading ? '...' : `${liveTotal.toLocaleString('th-TH')} แถวรวม`}
          </div>
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
        >
          {PURGE_TABLE_LABELS.map((row, idx) => {
            const count = liveCounts?.[row.key] ?? 0;
            const isLastRow = idx >= PURGE_TABLE_LABELS.length - (PURGE_TABLE_LABELS.length % 3 || 3);
            const isLastCol = (idx + 1) % 3 === 0;
            return (
              <div
                key={row.key}
                className="px-3 py-2.5"
                style={{
                  borderRight: isLastCol ? undefined : '1px solid var(--rule-hair)',
                  borderBottom: isLastRow ? undefined : '1px solid var(--rule-hair)',
                }}
              >
                <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--ink-navy-muted)]">
                  {row.label}
                </div>
                <div
                  className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums"
                  style={{
                    color: count > 0 ? 'var(--ink-navy)' : 'var(--ink-navy-muted)',
                  }}
                >
                  {countsLoading ? '—' : count.toLocaleString('th-TH')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="border-2 bg-white p-4"
        style={{ borderColor: 'var(--risk-high)' }}
      >
        <div
          className="mb-3 flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.06em]"
          style={{ color: 'var(--risk-high)' }}
        >
          <Eraser className="h-3.5 w-3.5" />
          ลบข้อมูล cached ของ {hospital.name}
        </div>

        <ul className="mb-3 space-y-1 font-mono text-[12px] leading-relaxed text-[var(--ink-navy-dim)]">
          <li>· ผู้ป่วยที่ admit (cached_patients) และ partograph / vital-signs / CPD scores ที่เกี่ยวข้อง</li>
          <li>· Maternal journeys และ ANC visits / risks / newborns ที่ผูกกับ journey</li>
          <li>· Referrals ที่โรงพยาบาลนี้เป็นต้นทางหรือปลายทาง</li>
          <li>· รีเซ็ต connection_status / last_sync_at เป็น UNKNOWN</li>
        </ul>

        <div
          className="mb-3 border bg-[var(--surface-cool)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--ink-navy-dim)]"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          <strong className="text-[var(--ink-navy)]">จะไม่ถูกลบ:</strong> tunnel URL / session,
          consult doctors, webhook API keys, audit logs, และข้อมูลโรงพยาบาลในตาราง <code>hospitals</code>
        </div>

        <Field label={`พิมพ์รหัสโรงพยาบาล (${hospital.hcode}) เพื่อยืนยัน`}>
          <Input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={hospital.hcode}
            className="h-9 font-mono"
            autoComplete="off"
            disabled={busy}
          />
        </Field>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <span className="font-mono text-[12px] text-[var(--ink-navy-muted)]">
            {confirmInput.trim() === hospital.hcode
              ? '✓ พร้อมยืนยันการลบ'
              : 'พิมพ์ hcode ให้ตรงเพื่อเปิดปุ่ม'}
          </span>
          <Button
            variant="destructive"
            onClick={handlePurge}
            disabled={!canSubmit}
            className="gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
            {busy ? 'กำลังลบ...' : 'ลบข้อมูลของโรงพยาบาลนี้'}
          </Button>
        </div>

        {error ? (
          <div
            className="mt-3 border px-3 py-2 font-mono text-[11px]"
            style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)' }}
          >
            {error}
          </div>
        ) : null}

        {result?.ok ? (
          <div
            className="mt-3 border bg-white px-3 py-2 font-mono text-[12px]"
            style={{ borderColor: 'var(--risk-low)' }}
          >
            <div
              className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em]"
              style={{ color: 'var(--risk-low)' }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              ลบข้อมูลสำเร็จ · ทั้งหมด {result.totalRowsDeleted ?? 0} แถว
            </div>
            {result.stoppedSync ? (
              <div className="text-[var(--ink-navy-dim)]">
                · หยุด onboarding sync ที่กำลังทำงานอยู่แล้ว
              </div>
            ) : null}
            {lines.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-[var(--ink-navy-dim)]">
                {lines.map((row) => (
                  <li key={row.label}>
                    · {row.label}: <strong className="text-[var(--ink-navy)]">{row.count}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[var(--ink-navy-muted)]">
                ไม่มีแถวข้อมูลให้ลบ (โรงพยาบาลยังไม่เคยถูก sync)
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────── Shared mini components ─────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink-navy-muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function StatusPill({
  tone,
  Icon,
  label,
}: {
  tone: Tone;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const color = toneColor(tone);
  return (
    <span
      className="inline-flex items-center gap-1 border px-2 py-1 font-mono text-[12px] font-semibold uppercase tracking-[0.06em]"
      style={{
        borderColor: color,
        color,
        background: tone === 'muted' ? 'white' : 'var(--surface-cool)',
      }}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function ProfileMetric({
  label,
  value,
  Icon,
  tone,
}: {
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
}) {
  const color = toneColor(tone);
  return (
    <div className="border bg-[var(--surface-cool)] px-3 py-2" style={{ borderColor: 'var(--rule-strong)' }}>
      <div className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink-navy-muted)]">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[13px] font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function HeaderFact({
  label,
  value,
  Icon,
  muted = false,
}: {
  label: string;
  value: string;
  Icon?: React.ComponentType<{ className?: string }>;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink-navy-muted)]">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </div>
      <div
        className="mt-0.5 truncate font-mono text-[13px]"
        style={{ color: muted ? 'var(--ink-navy-muted)' : 'var(--ink-navy)' }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  detail,
  Icon,
  meta,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  Icon: React.ComponentType<{ className?: string }>;
  meta?: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 border bg-white px-4 py-3 md:flex-row md:items-start md:justify-between"
      style={{ borderColor: 'var(--rule-strong)' }}
    >
      <div className="flex min-w-0 gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center border"
          style={{
            borderColor: 'var(--accent-navy)',
            color: 'var(--accent-navy)',
            background: 'var(--accent-navy-soft)',
          }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink-navy-muted)]">
            {eyebrow}
          </div>
          <div className="mt-0.5 text-[15px] font-semibold leading-tight text-[var(--ink-navy)]">
            {title}
          </div>
          <div className="mt-1 text-[13px] leading-snug text-[var(--ink-navy-dim)]">
            {detail}
          </div>
        </div>
      </div>
      {meta ? (
        <div className="shrink-0 border px-2.5 py-1.5 font-mono text-[12px] text-[var(--ink-navy-dim)] md:text-right"
          style={{ borderColor: 'var(--rule-strong)', background: 'var(--surface-cool)' }}>
          {meta}
        </div>
      ) : null}
    </div>
  );
}

function StatBox({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: string;
  tone: 'low' | 'muted' | 'navy';
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const color =
    tone === 'low'
      ? 'var(--risk-low)'
      : tone === 'navy'
        ? 'var(--accent-navy)'
        : 'var(--ink-navy-muted)';
  return (
    <div className="px-4 py-3" style={{ borderLeft: `2px solid ${color}` }}>
      <div className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink-navy-muted)]">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div
        className="mt-1 font-mono text-[14px] font-semibold leading-none"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}
