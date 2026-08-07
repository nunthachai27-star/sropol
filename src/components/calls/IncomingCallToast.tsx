'use client';

// Global incoming-call ring card: fixed bottom-right, survives page
// navigation because CallProvider mounts it at the layout level.
import { Phone, PhoneOff, Users, Video } from 'lucide-react';

interface IncomingCallToastProps {
  callerName: string;
  callerHospitalName: string;
  onAccept: () => void;
  onDecline: () => void;
  busy?: boolean;
  /** Ringing+joined people already on the call — >2 means a group call. */
  groupSize?: number;
}

export function IncomingCallToast({
  callerName,
  callerHospitalName,
  onAccept,
  onDecline,
  busy = false,
  groupSize,
}: IncomingCallToastProps) {
  const isGroup = (groupSize ?? 0) > 2;
  return (
    <div
      role="dialog"
      aria-label="สายเรียกเข้า"
      className="fixed right-6 bottom-6 z-[100] w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-2xl"
    >
      <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-600">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-100">
          <Video className="h-4 w-4 animate-pulse" />
        </span>
        สายเรียกเข้า (วิดีโอ)
        {isGroup && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
            <Users className="h-3 w-3" /> สายกลุ่ม · {groupSize} คน
          </span>
        )}
      </div>
      <div className="mt-2">
        <div className="text-[15px] font-bold text-slate-900">{callerName}</div>
        <div className="text-[12px] text-slate-500">{callerHospitalName}</div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onAccept}
          disabled={busy}
          className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Phone className="h-4 w-4" /> รับสาย
        </button>
        <button
          onClick={onDecline}
          disabled={busy}
          className="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PhoneOff className="h-4 w-4" /> ปฏิเสธ
        </button>
      </div>
    </div>
  );
}
