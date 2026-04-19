// Hospital maternity-ward kiosk page (Task 25). Renders the room-grouped
// WardLayoutView for the first ward returned by the BMS Session API, with a
// header summary (ward name, total/occupied/free counts) and a manual refresh
// button. Task 40 wires the PatientDrawer: clicking a bed opens the drawer
// with the matching occupant; closing resets selection.
'use client';
import { useState } from 'react';
import { useBmsSession } from '@/hooks/useBmsSession';
import { useMaternityWardState } from '@/hooks/useMaternityWardState';
import { WardLayoutView } from '@/components/maternity/WardLayoutView';
import { PatientDrawer } from '@/components/maternity/PatientDrawer';
import { RefreshCw } from 'lucide-react';

export default function HospitalMaternityWardPage() {
  const { isReady, error: sessionError } = useBmsSession();
  const { wards, ward, beds, occupancy, isLoading, error, mutateBeds, mutateOccupancy } =
    useMaternityWardState();
  const [selectedAn, setSelectedAn] = useState<string | null>(null);

  if (sessionError) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <p className="text-red-600">เกิดข้อผิดพลาด: {sessionError}</p>
      </div>
    );
  }
  if (!isReady) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center text-slate-500">
        เปิดหน้านี้จาก HOSxP เพื่อใช้งาน
        <br />
        <span className="text-xs">(ไม่พบ BMS Session — กรุณาเข้าผ่าน HOSxP)</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center text-red-600">
        ไม่สามารถโหลดข้อมูลห้องคลอด: {error.message}
      </div>
    );
  }

  if (isLoading || !ward) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center text-slate-500">กำลังโหลด…</div>
    );
  }

  const occupiedCount = occupancy.length;
  const totalBeds = beds.length;
  const wardName = wards.find((w) => w.ward === ward)?.name ?? `ward ${ward}`;
  const selectedOccupant = selectedAn
    ? (occupancy.find((o) => o.an === selectedAn) ?? null)
    : null;

  const handleRefresh = () => {
    void mutateBeds();
    void mutateOccupancy();
  };

  return (
    <div className="mx-auto max-w-[1400px] p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{wardName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {totalBeds} เตียง · ใช้งาน {occupiedCount} · ว่าง {totalBeds - occupiedCount}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-emerald-400"
        >
          <RefreshCw className="h-4 w-4" /> รีเฟรช
        </button>
      </header>

      <WardLayoutView beds={beds} occupancy={occupancy} onBedClick={setSelectedAn} />
      <PatientDrawer
        open={selectedAn !== null}
        occupant={selectedOccupant}
        onClose={() => setSelectedAn(null)}
      />
    </div>
  );
}
