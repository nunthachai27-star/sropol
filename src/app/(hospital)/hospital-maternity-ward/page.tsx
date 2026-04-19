// Stub maternity-ward kiosk page — Batch 3 placeholder. Real ward layout grid
// arrives in Batch 4 (Tasks 20-25). For now, the page validates that:
//   1. The (hospital) layout wires BmsSessionProvider correctly.
//   2. The BMS-session prompt renders when the user lands without a session.
//   3. The hospital identity is shown once the session resolves.
'use client';
import { useBmsSession } from '@/hooks/useBmsSession';

export default function HospitalMaternityWardPage() {
  const { isReady, userInfo, error } = useBmsSession();

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <p className="text-red-600">เกิดข้อผิดพลาด: {error}</p>
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
  return (
    <div className="mx-auto max-w-[1400px] p-6 lg:p-8">
      <h1 className="text-2xl font-bold">ห้องคลอด — {userInfo?.fullname}</h1>
      <p className="mt-2 text-sm text-slate-500">โรงพยาบาล: {userInfo?.hospcode}</p>
    </div>
  );
}
