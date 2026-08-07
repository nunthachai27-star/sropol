'use client';

// CallProvider — mounts once per authenticated layout. Owns the per-user
// signaling stream (/api/sse/calls), the incoming-ring state and the global
// call UI (ring toast + directory). The caller no longer waits behind an
// overlay: creating a call navigates straight into the room, where the
// participant strip shows who is ringing/joined/declined.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { IncomingCallToast } from './IncomingCallToast';
import { CallDirectoryDialog, type DirectoryCallTarget } from './CallDirectoryDialog';

interface IncomingCall {
  callId: string;
  roomId: string;
  inviter: { userId: string; name: string; hospitalCode: string; hospitalName: string };
  participantCount?: number;
}

interface CallContextValue {
  openDirectory: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

/** Null when no CallProvider is mounted (e.g. isolated component tests). */
export function useVideoCall(): CallContextValue | null {
  return useContext(CallContext);
}

// Soft ring: two-tone beep via Web Audio. Browsers may block audio until the
// user has interacted with the page — the visual toast is the primary signal.
function useRingtone(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined' || !('AudioContext' in window)) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const beep = (frequency: number, at: number) => {
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = frequency;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.08, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.4);
      } catch {
        // Autoplay policy — ignore, the toast is still visible.
      }
    };
    const ring = () => {
      beep(880, 0);
      beep(660, 0.45);
    };
    ring();
    const interval = window.setInterval(ring, 2000);
    return () => {
      window.clearInterval(interval);
      ctx?.close().catch(() => {});
    };
  }, [active]);
}

async function postCallAction(path: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(path, { method: 'POST' });
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return {
      ok: res.ok,
      message: body?.message ?? 'เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง',
    };
  } catch {
    return { ok: false, message: 'เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง' };
  }
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  useRingtone(Boolean(incoming));

  // Per-user signaling stream. EventSource reconnects automatically; a ring
  // lost during a reconnect resolves server-side via the 45 s missed timer.
  useEffect(() => {
    if (!userId) return;
    const source = new EventSource('/api/sse/calls');

    const parse = <T,>(event: MessageEvent): T | null => {
      try {
        return JSON.parse(event.data) as T;
      } catch {
        return null;
      }
    };

    const onInvite = (event: MessageEvent) => {
      const data = parse<IncomingCall>(event);
      if (data) setIncoming(data);
    };
    const clearIncoming = (event: MessageEvent) => {
      const data = parse<{ callId: string }>(event);
      setIncoming((current) =>
        current && data && current.callId === data.callId ? null : current,
      );
    };

    source.addEventListener('call:invite', onInvite);
    source.addEventListener('call:cancelled', clearIncoming);
    source.addEventListener('call:resolved', clearIncoming);

    return () => {
      source.close();
    };
  }, [userId]);

  // Start a call: on success the creator goes straight into the room; the
  // participant strip there shows ringing/declined/missed states live.
  const placeCall = useCallback(
    async (targets: DirectoryCallTarget[]): Promise<string | null> => {
      try {
        const res = await fetch('/api/calls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ calleeUserIds: targets.map((t) => t.userId) }),
        });
        const body = (await res.json()) as { callId?: string; message?: string };
        if (res.ok && body.callId) {
          setDirectoryOpen(false);
          router.push(`/calls/${body.callId}`);
          return null;
        }
        return body.message ?? 'ไม่สามารถโทรออกได้ กรุณาลองใหม่อีกครั้ง';
      } catch {
        return 'เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง';
      }
    },
    [router],
  );

  const acceptIncoming = useCallback(async () => {
    if (!incoming || actionBusy) return;
    setActionBusy(true);
    const result = await postCallAction(`/api/calls/${incoming.callId}/accept`);
    setActionBusy(false);
    if (result.ok) {
      router.push(`/calls/${incoming.callId}`);
    }
    // Failure means the ring was revoked/timed out — the matching
    // call:cancelled / call:resolved event clears the toast; do it here too
    // in case that event was missed during a reconnect.
    setIncoming(null);
  }, [incoming, actionBusy, router]);

  const declineIncoming = useCallback(async () => {
    if (!incoming || actionBusy) return;
    setActionBusy(true);
    await postCallAction(`/api/calls/${incoming.callId}/decline`);
    setActionBusy(false);
    setIncoming(null);
  }, [incoming, actionBusy]);

  const openDirectory = useCallback(() => setDirectoryOpen(true), []);

  return (
    <CallContext.Provider value={{ openDirectory }}>
      {children}
      <CallDirectoryDialog
        open={directoryOpen}
        onOpenChange={setDirectoryOpen}
        onCall={placeCall}
      />
      {incoming && (
        <IncomingCallToast
          callerName={incoming.inviter.name}
          callerHospitalName={incoming.inviter.hospitalName}
          groupSize={incoming.participantCount}
          onAccept={() => void acceptIncoming()}
          onDecline={() => void declineIncoming()}
          busy={actionBusy}
        />
      )}
    </CallContext.Provider>
  );
}
