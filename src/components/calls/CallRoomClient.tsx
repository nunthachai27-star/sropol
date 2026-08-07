'use client';

// Client body of /calls/[id]: resolves the call (participant-guarded API),
// shows the live participant strip, embeds the Jitsi room, lets any joined
// participant add more people, and reports leaving.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2, PhoneOff, UserPlus } from 'lucide-react';
import { JitsiRoom } from './JitsiRoom';
import { CallDirectoryDialog, type DirectoryCallTarget } from './CallDirectoryDialog';

interface ParticipantView {
  userId: string;
  name: string;
  hospitalCode: string;
  hospitalName: string;
  role: string;
  status: string;
}

interface CallView {
  callId: string;
  roomId: string;
  status: string;
  createdByUserId: string;
  createdByName: string;
  participants: ParticipantView[];
}

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  ringing: { label: 'กำลังเรียก…', className: 'bg-amber-500/20 text-amber-200' },
  joined: { label: 'เข้าร่วมแล้ว', className: 'bg-emerald-500/20 text-emerald-200' },
  declined: { label: 'ปฏิเสธ', className: 'bg-red-500/20 text-red-200' },
  missed: { label: 'ไม่รับสาย', className: 'bg-slate-500/30 text-slate-300' },
  cancelled: { label: 'ยกเลิก', className: 'bg-slate-500/30 text-slate-300' },
  left: { label: 'ออกแล้ว', className: 'bg-slate-500/30 text-slate-300' },
};

const PARTICIPANT_EVENTS = [
  'call:participant-joined',
  'call:participant-declined',
  'call:participant-missed',
  'call:participant-left',
  'call:cancelled',
];

export function CallRoomClient({ callId }: { callId: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [call, setCall] = useState<CallView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const leftRef = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/calls/${callId}`);
      const body = (await res.json()) as CallView & { message?: string };
      if (res.ok) {
        setCall(body);
        setError(null);
      } else {
        setError(body.message ?? 'ไม่พบข้อมูลสายนี้');
      }
    } catch {
      // Transient network failure — keep the last known state; the poll retries.
    }
  }, [callId]);

  useEffect(() => {
    // Deferred so the effect body itself does not set state synchronously
    // (react-compiler rule; same pattern as the TopNavBar clock).
    queueMicrotask(() => void refetch());
  }, [refetch]);

  // Live participant updates: personal signaling stream + polling fallback
  // (SSE reconnects can drop events; 15 s poll keeps the strip honest).
  useEffect(() => {
    const source = new EventSource('/api/sse/calls');
    const onAny = () => {
      void refetch();
    };
    for (const eventName of PARTICIPANT_EVENTS) {
      source.addEventListener(eventName, onAny);
    }
    const poll = window.setInterval(() => {
      void refetch();
    }, 15_000);
    return () => {
      source.close();
      window.clearInterval(poll);
    };
  }, [refetch]);

  // Presence heartbeat: the calls layout has no TopNavBar (which normally
  // heartbeats), and the server's stale-join sweep treats presence-absent
  // participants as gone — without this, users would be swept out of their
  // own call after the presence TTL.
  useEffect(() => {
    const beat = () => {
      fetch('/api/presence/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/calls' }),
        keepalive: true,
      }).catch(() => {
        // Best-effort — the poll + sweep margins tolerate missed beats.
      });
    };
    beat();
    const interval = window.setInterval(beat, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const leave = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    // keepalive: router.back() navigates immediately and a plain fetch would
    // be aborted mid-flight — the leave then never reaches the server and the
    // participant stays "joined"/busy (2026-07-11 incident).
    void fetch(`/api/calls/${callId}/leave`, { method: 'POST', keepalive: true }).catch(() => {});
    router.back();
  }, [callId, router]);

  // Tab close / navigation away without pressing วางสาย: pagehide is the
  // last reliable moment to tell the server; sendBeacon survives unload.
  useEffect(() => {
    const onPageHide = () => {
      if (leftRef.current) return;
      leftRef.current = true;
      navigator.sendBeacon?.(`/api/calls/${callId}/leave`);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [callId]);

  const inviteMore = useCallback(
    async (targets: DirectoryCallTarget[]): Promise<string | null> => {
      try {
        const res = await fetch(`/api/calls/${callId}/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calleeUserIds: targets.map((t) => t.userId) }),
        });
        const body = (await res.json()) as {
          invited?: unknown[];
          skipped?: { userId: string }[];
          message?: string;
        };
        if (!res.ok) {
          return body.message ?? 'ไม่สามารถเชิญได้ กรุณาลองใหม่อีกครั้ง';
        }
        void refetch();
        if (body.skipped && body.skipped.length > 0) {
          return `เชิญแล้ว ${body.invited?.length ?? 0} คน — ข้าม ${body.skipped.length} คน (ออฟไลน์ สายไม่ว่าง หรืออยู่ในสายแล้ว)`;
        }
        setInviteOpen(false);
        return null;
      } catch {
        return 'เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง';
      }
    },
    [callId, refetch],
  );

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="text-[15px] font-semibold text-white">{error}</p>
          <button
            onClick={() => router.back()}
            className="mt-4 cursor-pointer rounded-md border border-white/30 px-4 py-2 text-[13px] font-semibold text-white hover:bg-white/10"
          >
            กลับ
          </button>
        </div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-2 text-[14px] text-white/80">
          <Loader2 className="h-5 w-5 animate-spin" /> กำลังเชื่อมต่อห้องสนทนา…
        </div>
      </div>
    );
  }

  if (call.status !== 'active') {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="text-[15px] font-semibold text-white">สายนี้สิ้นสุดแล้ว</p>
          <button
            onClick={() => router.back()}
            className="mt-4 cursor-pointer rounded-md border border-white/30 px-4 py-2 text-[13px] font-semibold text-white hover:bg-white/10"
          >
            กลับ
          </button>
        </div>
      </div>
    );
  }

  const myUserId = session?.user?.id;
  const others = call.participants.filter((p) => p.userId !== myUserId);
  const displayName = session?.user?.name
    ? `${session.user.name} (${session.user.hospitalName ?? ''})`
    : 'SR-LRMS';

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-wrap items-center gap-2 bg-slate-900 px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {others.map((participant) => {
            const chip = STATUS_CHIP[participant.status] ?? {
              label: participant.status,
              className: 'bg-slate-500/30 text-slate-300',
            };
            return (
              <span
                key={participant.userId}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/5 py-1 pr-1.5 pl-2.5 text-[12px] text-white/90"
                title={`${participant.name} · ${participant.hospitalName}`}
              >
                <span className="truncate">{participant.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.className}`}
                >
                  {chip.label}
                </span>
              </span>
            );
          })}
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-white/25 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-white/10"
        >
          <UserPlus className="h-3.5 w-3.5" /> เพิ่มผู้เข้าร่วม
        </button>
        <button
          onClick={leave}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-red-700"
        >
          <PhoneOff className="h-3.5 w-3.5" /> วางสาย
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <JitsiRoom roomId={call.roomId} displayName={displayName} onLeft={leave} />
      </div>
      <CallDirectoryDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCall={inviteMore}
        title="เพิ่มผู้เข้าร่วมสาย"
        actionLabel="เชิญ"
      />
    </div>
  );
}
